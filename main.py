"""
Forsys RAG — FastAPI Backend
Endpoints:
  GET  /health          — liveness check
  POST /chat            — RAG-powered chat
  POST /ingest/pdf      — upload and index a PDF at runtime
"""

import os
import re
import json
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
import chromadb
import anthropic
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

from ingest import extract_pdf_text, chunk_text, _embed_and_store, COLLECTION_NAME, CHROMA_PATH, EMBED_MODEL

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
] or ["*"]
EMBED_BASE_URL = os.getenv("EMBED_BASE_URL", "http://localhost:8080/embed")

TOP_K = 5           # number of context chunks to retrieve
MAX_HISTORY = 6     # conversation turns to keep in context

SYSTEM_PROMPT = """You are ForsysGPT — a knowledgeable, professional AI assistant for Forsys Inc., a leading Revenue Lifecycle Management consulting firm.

PRIORITY — When a user asks what Forsys does, what Forsys offers, or anything general about Forsys, always lead with and focus on the "What We Do" areas:

1. SERVICES: Revenue Lifecycle Strategy, AI-Enabled Managed Services, AI Agents Development, AI Application Development, Autonomous Commerce, Build or Buy Strategy, Data Migration, DevOps, Enterprise AI Strategy, Integrations.

2. SOLUTIONS — Salesforce: Agentforce CRM, Agentforce Revenue Management, Agentforce Commerce, Agentforce Platform, Manufacturing Cloud.

3. SOLUTIONS — Conga + PROS: Revenue & Commerce, Contract Lifecycle Management, PROS B2B, PROS Smart Pricing.

4. SOLUTIONS — Oracle: Fusion Supply Chain & Manufacturing, Fusion Finance & Accounting, OIC / PaaS, BPA / AI Studio.

5. AI-POWERED FORSYS SOLUTIONS (proprietary products): RevRamp (CPQ migration), LexiShift (contract intelligence), RevMove (data migration), MnA for Salesforce (mergers & acquisitions), AITest (AI testing), AI Agents (autonomous agents).

Always use the context retrieved below to give specific, accurate answers. If a user asks about Forsys generally, structure your answer around the What We Do categories above before mentioning industries, company info, or anything else.

FORMATTING RULES — strictly follow these:
- Never use markdown tables (no | column | column | rows). Present tabular data as bullet points or bold label: value pairs instead.
- Use bullet lists, bold labels, and short paragraphs only.
- Be concise — lead with the most important point, then supporting detail. Avoid filler phrases like "Great question!" or "Certainly!".
- Numbers and outcomes should be bold (e.g. **37% increase**). Keep each bullet to one clear idea.

IMPORTANT — Case study links: Each context chunk that comes from a case study PDF includes a [View Case Study] URL on the first line. Whenever you reference or summarise a case study, you MUST include that link in your reply formatted as a markdown link, e.g. [View full case study →](URL). If the user asks for a case study or you are pulling data from one, always invite them to open the full case study using that link.

CONTEXT:
{context}"""


def embed_url_for(source: str) -> str | None:
    """Return the embed page URL for a PDF source, or None if not a PDF."""
    if source.lower().endswith(".pdf"):
        stem = Path(source).stem
        return f"{EMBED_BASE_URL}/{stem}.html"
    return None


# ── Startup: load shared resources once ──────────────────────────────────────

embed_model: SentenceTransformer = None
chroma_collection = None
anthropic_client: anthropic.Anthropic = None
anthropic_async_client: anthropic.AsyncAnthropic = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global embed_model, chroma_collection, anthropic_client, anthropic_async_client

    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.")

    print("Loading embedding model...")
    embed_model = SentenceTransformer(EMBED_MODEL)

    print("Connecting to ChromaDB...")
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    chroma_collection = client.get_or_create_collection(COLLECTION_NAME)
    print(f"ChromaDB ready — {chroma_collection.count()} chunks indexed.")

    anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    anthropic_async_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    print("Ready.")
    yield


app = FastAPI(title="Forsys RAG API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ────────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str   # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []

class ChatResponse(BaseModel):
    reply: str
    sources: list[str]
    embed_links: dict[str, str] = {}  # source filename → embed page URL


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/widget.js")
def widget_js():
    js_path = Path(__file__).parent / "static" / "forsys-chat.js"
    return Response(content=js_path.read_text(encoding="utf-8"), media_type="application/javascript")


@app.get("/health")
def health():
    return {"status": "ok", "chunks_indexed": chroma_collection.count()}


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    # 1. Embed the query (blocking — run in thread so event loop stays free)
    query_embedding = await anyio.to_thread.run_sync(
        lambda: embed_model.encode([req.message])[0].tolist()
    )

    # 2. Retrieve top-K relevant chunks
    results = chroma_collection.query(
        query_embeddings=[query_embedding],
        n_results=min(TOP_K, chroma_collection.count() or 1),
        include=["documents", "metadatas"],
    )
    docs = results["documents"][0] if results["documents"] else []
    metas = results["metadatas"][0] if results["metadatas"] else []

    # Build context
    embed_links: dict[str, str] = {}
    context_parts = []
    for doc, meta in zip(docs, metas):
        source = meta.get("source", "")
        url = embed_url_for(source)
        if url:
            embed_links[source] = url
            context_parts.append(f"[View Case Study: {url}]\n{doc}")
        else:
            context_parts.append(doc)
    context = "\n\n---\n\n".join(context_parts) if context_parts else "No relevant content found."
    sources = list({m.get("source", "") for m in metas if m.get("source")})

    # 3. Build messages for Claude
    system = SYSTEM_PROMPT.format(context=context)
    history = req.history[-(MAX_HISTORY * 2):]
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": req.message})

    # 4. Stream response via SSE using fully async generator
    async def generate():
        try:
            yield f"data: {json.dumps({'type': 'meta', 'sources': sources, 'embed_links': embed_links})}\n\n"
            async with anthropic_async_client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=system,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'delta', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            print(f"[STREAM ERROR] {type(e).__name__}: {e}", flush=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/ingest/pdf")
async def ingest_pdf_upload(file: UploadFile = File(...)):
    """Upload a PDF and add it to the knowledge base at runtime."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        text = extract_pdf_text(tmp_path)
        chunks = chunk_text(text, source=file.filename)
        _embed_and_store(chunks, chroma_collection, embed_model, label=file.filename)
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"status": "ok", "chunks_added": len(chunks), "total": chroma_collection.count()}

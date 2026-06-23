"""
Forsys RAG — FastAPI Backend (BM25 edition)
Endpoints:
  GET  /health   — liveness check
  POST /chat     — RAG-powered chat
"""

import os
import json
from contextlib import asynccontextmanager
from pathlib import Path

import anthropic
from rank_bm25 import BM25Okapi
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
] or ["*"]

TOP_K = 5
MAX_HISTORY = 6

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


# ── Globals ───────────────────────────────────────────────────────────────────

docs: list[dict] = []
bm25: BM25Okapi = None
anthropic_async_client: anthropic.AsyncAnthropic = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global docs, bm25, anthropic_async_client

    try:
        print(f"[1] ANTHROPIC_API_KEY set: {bool(ANTHROPIC_API_KEY)}", flush=True)
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not set.")

        print("[2] Loading documents...", flush=True)
        docs_path = Path(__file__).parent / "docs.json"
        print(f"[2] docs.json path: {docs_path} exists={docs_path.exists()}", flush=True)
        docs = json.loads(docs_path.read_text(encoding="utf-8"))
        print(f"[2] Loaded {len(docs)} docs", flush=True)

        print("[3] Building BM25 index...", flush=True)
        tokenized = [d["text"].lower().split() for d in docs]
        bm25 = BM25Okapi(tokenized)
        print("[3] BM25 ready", flush=True)

        print("[4] Creating Anthropic client...", flush=True)
        anthropic_async_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        print(f"[4] Ready — {len(docs)} documents indexed.", flush=True)
    except Exception as e:
        import traceback
        print(f"[STARTUP FAILED] {type(e).__name__}: {e}", flush=True)
        traceback.print_exc()
        raise
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
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/widget.js")
def widget_js():
    js_path = Path(__file__).parent / "static" / "forsys-chat.js"
    return Response(content=js_path.read_text(encoding="utf-8"), media_type="application/javascript")


@app.get("/health")
def health():
    return {"status": "ok", "chunks_indexed": len(docs)}


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    # BM25 retrieval
    tokens = req.message.lower().split()
    scores = bm25.get_scores(tokens)
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:TOP_K]
    top_docs = [docs[i] for i in top_indices]

    sources = list({d["source"] for d in top_docs if d["source"]})
    context = "\n\n---\n\n".join(d["text"] for d in top_docs) or "No relevant content found."

    system = SYSTEM_PROMPT.format(context=context)
    history = req.history[-(MAX_HISTORY * 2):]
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": req.message})

    async def generate():
        try:
            yield f"data: {json.dumps({'type': 'meta', 'sources': sources, 'embed_links': {}})}\n\n"
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


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    print(f"[STARTUP] Starting on port {port}", flush=True)
    uvicorn.run("main:app", host="0.0.0.0", port=port)

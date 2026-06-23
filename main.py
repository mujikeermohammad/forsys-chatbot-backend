"""
Forsys RAG — FastAPI Backend (BM25 + Lead Capture edition)
Endpoints:
  GET  /health                     — liveness check
  GET  /widget.js                  — serve widget script
  POST /chat                       — RAG-powered chat (accepts name + email)
  GET  /dashboard                  — lead dashboard UI
  GET  /api/leads                  — list all leads (JSON)
  GET  /api/leads/{id}/messages    — messages for a lead
  PUT  /api/leads/{id}             — update lead name/email
  DELETE /api/leads/{id}           — delete lead + messages
"""

import os
import json
import sqlite3
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import httpx
from rank_bm25 import BM25Okapi
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse, Response, HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY  = os.getenv("ANTHROPIC_API_KEY", "")
DASHBOARD_TOKEN    = os.getenv("DASHBOARD_TOKEN", "forsys-admin")
DB_PATH            = os.getenv("DB_PATH", str(Path(__file__).parent / "leads.db"))
ALLOWED_ORIGINS    = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()] or ["*"]
TOP_K              = 5
MAX_HISTORY        = 6

# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS leads (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL,
            first_seen TEXT NOT NULL,
            last_seen  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id    INTEGER NOT NULL,
            question   TEXT NOT NULL,
            answer     TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
    """)
    conn.commit()
    conn.close()

def upsert_lead(name: str, email: str) -> int:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM leads WHERE email = ?", (email,)).fetchone()
        if row:
            conn.execute("UPDATE leads SET last_seen = ?, name = ? WHERE id = ?", (now, name, row["id"]))
            lead_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO leads (name, email, first_seen, last_seen) VALUES (?, ?, ?, ?)",
                (name, email, now, now),
            )
            lead_id = cur.lastrowid
        conn.commit()
        return lead_id
    finally:
        conn.close()

def save_message(lead_id: int, question: str, answer: str):
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO messages (lead_id, question, answer, created_at) VALUES (?, ?, ?, ?)",
            (lead_id, question, answer, now),
        )
        conn.commit()
    finally:
        conn.close()


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are ForsysGPT — a knowledgeable, professional AI assistant for Forsys Inc., a leading Revenue Lifecycle Management consulting firm.

PRIORITY — When a user asks what Forsys does, what Forsys offers, or anything general about Forsys, always lead with and focus on the "What We Do" areas:

1. SERVICES: Revenue Lifecycle Strategy, AI-Enabled Managed Services, AI Agents Development, AI Application Development, Autonomous Commerce, Build or Buy Strategy, Data Migration, DevOps, Enterprise AI Strategy, Integrations.

2. SOLUTIONS — Salesforce: Agentforce CRM, Agentforce Revenue Management, Agentforce Commerce, Agentforce Platform, Manufacturing Cloud.

3. SOLUTIONS — Conga + PROS: Revenue & Commerce, Contract Lifecycle Management, PROS B2B, PROS Smart Pricing.

4. SOLUTIONS — Oracle: Fusion Supply Chain & Manufacturing, Fusion Finance & Accounting, OIC / PaaS, BPA / AI Studio.

5. AI-POWERED FORSYS SOLUTIONS (proprietary products): RevRamp (CPQ migration), LexiShift (contract intelligence), RevMove (data migration), MnA for Salesforce (mergers & acquisitions), AITest (AI testing), AI Agents (autonomous agents).

Always use the context retrieved below to give specific, accurate answers. If a user asks about Forsys generally, structure your answer around the What We Do categories above before mentioning industries, company info, or anything else.

FORMATTING RULES — strictly follow these:
- Never use markdown tables. Present tabular data as bullet points or bold label: value pairs instead.
- Use bullet lists, bold labels, and short paragraphs only.
- Be concise — lead with the most important point. Avoid filler phrases like "Great question!" or "Certainly!".
- Numbers and outcomes should be bold (e.g. **37% increase**).

IMPORTANT — Case study links: Each context chunk from a case study PDF includes a [View Case Study] URL. Whenever you reference a case study, include that link as [View full case study →](URL).

CONTEXT:
{context}"""


# ── Globals ───────────────────────────────────────────────────────────────────

docs: list[dict] = []
bm25: BM25Okapi = None
anthropic_async_client: anthropic.AsyncAnthropic = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global docs, bm25, anthropic_async_client

    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    print("[1] Initialising database...", flush=True)
    init_db()

    print("[2] Loading documents...", flush=True)
    docs_path = Path(__file__).parent / "docs.json"
    docs = json.loads(docs_path.read_text(encoding="utf-8"))

    print("[3] Building BM25 index...", flush=True)
    bm25 = BM25Okapi([d["text"].lower().split() for d in docs])

    print("[4] Creating Anthropic client...", flush=True)
    anthropic_async_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    print(f"Ready — {len(docs)} documents indexed.", flush=True)

    render_url = os.getenv("RENDER_EXTERNAL_URL", "")
    async def keep_alive():
        while True:
            await asyncio.sleep(600)
            if render_url:
                try:
                    async with httpx.AsyncClient() as client:
                        await client.get(f"{render_url}/health", timeout=10)
                    print("[KEEP-ALIVE] pinged /health", flush=True)
                except Exception as e:
                    print(f"[KEEP-ALIVE] failed: {e}", flush=True)

    task = asyncio.create_task(keep_alive())
    yield
    task.cancel()


app = FastAPI(title="Forsys RAG API", lifespan=lifespan)


# ── CORS middleware ───────────────────────────────────────────────────────────

@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        origin = request.headers.get("origin", "*")
        allowed = origin if ("*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS) else ""
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": allowed,
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "86400",
            },
        )
    response = await call_next(request)
    origin = request.headers.get("origin", "")
    if "*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin or "*"
    return response


# ── Auth helper ───────────────────────────────────────────────────────────────

def check_token(token: str = ""):
    if token != DASHBOARD_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token.")


# ── Models ────────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []
    name: str = ""
    email: str = ""

class LeadUpdate(BaseModel):
    name: str
    email: str


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

    # Upsert lead if name/email provided
    lead_id = None
    if req.email.strip() and req.name.strip():
        try:
            lead_id = upsert_lead(req.name.strip(), req.email.strip().lower())
        except Exception as e:
            print(f"[LEAD] upsert failed: {e}", flush=True)

    system   = SYSTEM_PROMPT.format(context=context)
    history  = req.history[-(MAX_HISTORY * 2):]
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": req.message})

    async def generate():
        full_answer = ""
        try:
            yield f"data: {json.dumps({'type': 'meta', 'sources': sources, 'embed_links': {}})}\n\n"
            async with anthropic_async_client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=system,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    full_answer += text
                    yield f"data: {json.dumps({'type': 'delta', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            print(f"[STREAM ERROR] {type(e).__name__}: {e}", flush=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            if lead_id and req.message:
                try:
                    save_message(lead_id, req.message, full_answer)
                except Exception as e:
                    print(f"[LEAD] save_message failed: {e}", flush=True)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(token: str = ""):
    check_token(token)
    html = Path(__file__).parent / "static" / "dashboard.html"
    content = html.read_text(encoding="utf-8").replace("__TOKEN__", token)
    return HTMLResponse(content=content)


@app.get("/api/leads")
def api_leads(token: str = ""):
    check_token(token)
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT l.id, l.name, l.email, l.first_seen, l.last_seen,
                   COUNT(m.id) as message_count
            FROM leads l
            LEFT JOIN messages m ON m.lead_id = l.id
            GROUP BY l.id
            ORDER BY l.last_seen DESC
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/leads/{lead_id}/messages")
def api_lead_messages(lead_id: int, token: str = ""):
    check_token(token)
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, question, answer, created_at FROM messages WHERE lead_id = ? ORDER BY created_at ASC",
            (lead_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/api/leads/{lead_id}")
def api_update_lead(lead_id: int, body: LeadUpdate, token: str = ""):
    check_token(token)
    conn = get_db()
    try:
        conn.execute("UPDATE leads SET name = ?, email = ? WHERE id = ?", (body.name, body.email, lead_id))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@app.delete("/api/leads/{lead_id}")
def api_delete_lead(lead_id: int, token: str = ""):
    check_token(token)
    conn = get_db()
    try:
        conn.execute("DELETE FROM messages WHERE lead_id = ?", (lead_id,))
        conn.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()

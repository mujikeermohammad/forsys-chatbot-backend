import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sentence_transformers import SentenceTransformer
from ingest import get_chroma_collection, extract_pdf_text, chunk_text, _embed_and_store

BASE = Path(r"C:\Users\mujikeer.mohammad_fo\Downloads\forsys-website-new-main")
EXCLUDE = {".claude", "venv", "node_modules", "forsys-rag"}

pdfs = [
    p for p in BASE.rglob("*.pdf")
    if not any(ex in p.parts for ex in EXCLUDE)
]
print(f"Found {len(pdfs)} PDFs to ingest")

print("Loading embedding model...")
model = SentenceTransformer("all-MiniLM-L6-v2")
collection = get_chroma_collection(reset=False)
print(f"Collection currently has {collection.count()} chunks\n")

ok = skip = 0
for i, pdf in enumerate(pdfs, 1):
    try:
        text = extract_pdf_text(pdf)
        if len(text.strip()) < 100:
            print(f"  [{i}/{len(pdfs)}] SKIP (empty): {pdf.name}")
            skip += 1
            continue
        chunks = chunk_text(text, source=pdf.name)
        _embed_and_store(chunks, collection, model, label=pdf.name)
        print(f"  [{i}/{len(pdfs)}] OK ({len(chunks)} chunks): {pdf.name}")
        ok += 1
    except Exception as e:
        print(f"  [{i}/{len(pdfs)}] ERROR: {pdf.name} — {e}")
        skip += 1

print(f"\nDone. Ingested: {ok}  Skipped: {skip}  Total chunks in DB: {collection.count()}")

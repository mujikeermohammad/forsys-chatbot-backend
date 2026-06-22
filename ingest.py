"""
Forsys RAG — Ingestion Script
Extracts text from HTML pages and PDFs, chunks them, embeds with
sentence-transformers, and stores in ChromaDB.

Usage:
  python ingest.py --html ../forsys-website-new-main   # index HTML pages
  python ingest.py --pdf path/to/doc.pdf               # index a single PDF
  python ingest.py --clear                              # wipe and re-index
"""

import argparse
import os
import re
import sys
from pathlib import Path

import chromadb
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader

CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "forsys_knowledge"
CHUNK_SIZE = 600        # tokens (approx characters / 4)
CHUNK_OVERLAP = 80
EMBED_MODEL = "all-MiniLM-L6-v2"

# Sections to skip in HTML (nav, footer, script, style)
SKIP_TAGS = {"nav", "footer", "script", "style", "noscript", "head"}


def get_chroma_collection(reset: bool = False):
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
            print("Cleared existing collection.")
        except Exception:
            pass
    return client.get_or_create_collection(COLLECTION_NAME)


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def chunk_text(text: str, source: str) -> list[dict]:
    words = text.split()
    chunks = []
    i = 0
    idx = 0
    step = max(1, CHUNK_SIZE - CHUNK_OVERLAP)
    while i < len(words):
        chunk = " ".join(words[i : i + CHUNK_SIZE])
        if len(chunk) > 60:
            chunks.append({"text": chunk, "source": source, "chunk_idx": idx})
            idx += 1
        i += step
    return chunks


def extract_html_text(path: Path) -> str:
    with open(path, encoding="utf-8", errors="ignore") as f:
        soup = BeautifulSoup(f, "html.parser")
    for tag in soup(SKIP_TAGS):
        tag.decompose()
    # Get page title
    title = soup.title.string if soup.title else path.stem
    body_text = soup.get_text(separator=" ")
    return f"{title}\n\n{clean_text(body_text)}"


def extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    pages = [page.extract_text() or "" for page in reader.pages]
    return clean_text(" ".join(pages))


def ingest_html_directory(directory: Path, collection, model):
    html_files = list(directory.rglob("*.html"))
    print(f"Found {len(html_files)} HTML files in {directory}")
    all_chunks = []
    for f in html_files:
        try:
            text = extract_html_text(f)
            rel = str(f.relative_to(directory))
            all_chunks.extend(chunk_text(text, source=rel))
        except Exception as e:
            print(f"  Skipping {f.name}: {e}")

    _embed_and_store(all_chunks, collection, model, label="HTML")


def ingest_pdf(path: Path, collection, model):
    print(f"Ingesting PDF: {path.name}")
    text = extract_pdf_text(path)
    chunks = chunk_text(text, source=path.name)
    _embed_and_store(chunks, collection, model, label=path.name)


def _embed_and_store(chunks: list[dict], collection, model, label: str):
    if not chunks:
        print(f"  No chunks to store for {label}.")
        return

    texts = [c["text"] for c in chunks]
    print(f"  Embedding {len(texts)} chunks for {label}...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)

    ids = [f"{c['source']}__chunk{c['chunk_idx']}" for c in chunks]
    # ChromaDB IDs must be unique strings; truncate/sanitise
    ids = [re.sub(r"[^a-zA-Z0-9_\-]", "_", i)[:512] for i in ids]

    metadatas = [{"source": c["source"], "chunk_idx": c["chunk_idx"]} for c in chunks]

    # Upsert in batches of 500
    batch = 500
    for start in range(0, len(ids), batch):
        collection.upsert(
            ids=ids[start : start + batch],
            embeddings=embeddings[start : start + batch].tolist(),
            documents=texts[start : start + batch],
            metadatas=metadatas[start : start + batch],
        )
    print(f"  Stored {len(ids)} chunks.")


def main():
    parser = argparse.ArgumentParser(description="Forsys RAG ingestion")
    parser.add_argument("--html", help="Directory containing HTML pages to index")
    parser.add_argument("--pdf", help="Path to a PDF file to index")
    parser.add_argument("--clear", action="store_true", help="Clear DB before indexing")
    args = parser.parse_args()

    if not (args.html or args.pdf):
        parser.print_help()
        sys.exit(1)

    print(f"Loading embedding model ({EMBED_MODEL})...")
    model = SentenceTransformer(EMBED_MODEL)

    collection = get_chroma_collection(reset=args.clear)

    if args.html:
        ingest_html_directory(Path(args.html), collection, model)

    if args.pdf:
        ingest_pdf(Path(args.pdf), collection, model)

    print(f"\nDone. Total docs in collection: {collection.count()}")


if __name__ == "__main__":
    main()

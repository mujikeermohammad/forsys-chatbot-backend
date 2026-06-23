"""Export all ChromaDB documents to docs.json for BM25 retrieval."""
import json
import chromadb
from ingest import CHROMA_PATH, COLLECTION_NAME

client = chromadb.PersistentClient(path=CHROMA_PATH)
col = client.get_collection(COLLECTION_NAME)

result = col.get(include=["documents", "metadatas"])
docs = [
    {"text": doc, "source": meta.get("source", "")}
    for doc, meta in zip(result["documents"], result["metadatas"])
]

with open("docs.json", "w", encoding="utf-8") as f:
    json.dump(docs, f, ensure_ascii=False, indent=2)

print(f"Exported {len(docs)} documents to docs.json")

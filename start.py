import os
import uvicorn

port = int(os.environ.get("PORT", 8080))
print(f"[START] Binding to port {port}", flush=True)
uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")

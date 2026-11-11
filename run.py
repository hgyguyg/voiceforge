"""本地启动：python run.py  →  http://127.0.0.1:8000"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "app"))

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    print(f"\n  造声 VOICEFORGE  ·  http://127.0.0.1:{port}\n")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(tempfile.mkdtemp(prefix="homegym-e2e-"))
os.environ["DATA_DIR"] = str(DATA)
os.environ["BACKGROUND_WORKERS"] = "0"
os.environ["AUTO_VIDEO"] = "0"
os.environ["AI_PROVIDER"] = "gemini"
os.environ["GEMINI_API_KEY"] = ""
os.environ.setdefault("WEB_DIR", str(ROOT / "app" / "web"))
sys.path.insert(0, str(ROOT / "app"))

import uvicorn

import architect
import coach
import db
import engine
import main
import onboarding


def finish_onboarding(user_id):
    with db.transaction() as conn:
        conn.execute("UPDATE users SET status = 'ready', status_message = '' WHERE id = ?", (user_id,))


onboarding.start_async = finish_onboarding
architect.run_rebuild = lambda user_id, request: None
coach._generate_brief_ai = lambda *args, **kwargs: None
coach.start_outro = lambda user_id, session_id: None
engine.session_note = lambda session_id: None

if __name__ == "__main__":
    uvicorn.run(main.app, host="127.0.0.1", port=int(os.environ.get("E2E_PORT", "8765")), log_level="warning")

import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import alexa
import coach
import coach_api
import config as app_config
import cycle
import db
import engine
import nutrition
import reviewer
import settings_api
from db import query_one
from deps import known_user
from routes import coaching, equipment, exercises, insights, leaderboard, programs, quality, sessions, users
from workers import auto_video_worker, block_worker, for_each_user

STATIC_DIR = Path(__file__).parent / "static"
WEB_DIR = Path(os.environ.get("WEB_DIR", str(Path(__file__).parent / "web")))
RESERVED_PREFIXES = ("api/", "static/", "media/", "alexa/", "assets/")


def background_workers_enabled():
    return os.environ.get("BACKGROUND_WORKERS", "1") == "1"


@asynccontextmanager
async def lifespan(application):
    db.init_db()
    cycle.init_schema()
    nutrition.init_schema()
    for_each_user(engine.seed_target_weights)
    if background_workers_enabled():
        threading.Thread(target=block_worker, daemon=True).start()
        threading.Thread(target=reviewer.worker, daemon=True).start()
        threading.Thread(target=coach.prepare_worker, daemon=True).start()
        threading.Thread(target=nutrition.worker, daemon=True).start()
        if app_config.get_bool("auto_video"):
            threading.Thread(target=auto_video_worker, daemon=True).start()
        alexa.start_worker()
    yield


app = FastAPI(title="Home Gym", version="2.0.0", lifespan=lifespan)


@app.middleware("http")
async def user_context(request: Request, call_next):
    raw = request.headers.get("x-user-id", "")
    token = None
    if raw.isdigit() and known_user(int(raw)):
        token = db.set_current_user(int(raw))
    try:
        return await call_next(request)
    finally:
        if token is not None:
            db.reset_current_user(token)


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/static/") and path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(db.NoUser)
async def no_user_handler(request: Request, exc):
    return JSONResponse({"detail": "Choose a user first"}, status_code=401)


for module in (exercises, equipment, programs, sessions, insights, coaching, users, leaderboard, quality):
    app.include_router(module.router)
app.include_router(coach_api.router)
app.include_router(cycle.router)
alexa.attach(app, leaderboard.user_period_stats)
settings_api.attach(app)
nutrition.attach(app)


@app.get("/healthz")
def health():
    query_one("SELECT 1 AS ok")
    return {"ok": True}


db.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=db.MEDIA_DIR), name="media")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if (WEB_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")


def web_file(path):
    if not path:
        return None
    root = WEB_DIR.resolve()
    candidate = (root / path).resolve()
    if candidate.is_file() and root in candidate.parents:
        return candidate
    return None


@app.get("/{path:path}", include_in_schema=False)
def single_page_app(path: str):
    if path.startswith(RESERVED_PREFIXES):
        raise HTTPException(404, "Not found")
    file = web_file(path)
    if file:
        return FileResponse(file)
    index = WEB_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(503, "The web app is not built yet. Run npm run build in the frontend folder.")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})

import json
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import ai
import architect
import catalog
import coach
import coach_api
import cycle
import db
import engine
import onboarding
import planner
import reviewer
import youtube
import config as app_config
import settings_api
import nutrition
from db import query_all, query_one, transaction, now_iso

STATIC_DIR = Path(__file__).parent / "static"
AUTO_VIDEO = os.environ.get("AUTO_VIDEO", "1") == "1"
MEASURES = ("reps", "sec", "min", "none")
MEDIA_KINDS = ("loop", "muscles")
MEDIA_TYPES = {
    "image/gif": ".gif", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
}
MAX_MEDIA_BYTES = 60 * 1024 * 1024


def auto_video_worker():
    time.sleep(3)
    while True:
        pending = query_all(
            "SELECT id, name FROM exercises WHERE (video_id IS NULL OR video_id = '') AND video_auto_tried = 0 ORDER BY id"
        )
        if not pending:
            time.sleep(60)
            continue
        network_failed = False
        for item in pending:
            try:
                best = youtube.pick_best(item["name"])
            except Exception:
                network_failed = True
                break
            with transaction() as conn:
                current = conn.execute("SELECT video_id FROM exercises WHERE id = ?", (item["id"],)).fetchone()
                if current is None:
                    continue
                if best and not current["video_id"]:
                    conn.execute(
                        "UPDATE exercises SET video_id = ?, video_title = ?, video_source = 'auto', video_auto_tried = 1 WHERE id = ?",
                        (best["video_id"], best["title"], item["id"]),
                    )
                else:
                    conn.execute("UPDATE exercises SET video_auto_tried = 1 WHERE id = ?", (item["id"],))
            time.sleep(1.5)
        if network_failed:
            time.sleep(300)


def for_each_user(callback):
    for user in query_all("SELECT id FROM users WHERE status = 'ready'"):
        with db.as_user(user["id"]):
            try:
                callback()
            except engine.AIUnavailable as error:
                print("user", user["id"], "waiting for AI:", error, flush=True)
            except Exception as error:
                print("user", user["id"], "worker error:", error, flush=True)


def maintenance():
    engine.ensure_block()
    engine.run_pending_progression()
    engine.fix_unavailable_items()


def block_worker():
    while True:
        try:
            onboarding.retry_waiting()
        except Exception as error:
            print("onboarding retry:", error, flush=True)
        for_each_user(maintenance)
        time.sleep(600)


@asynccontextmanager
async def lifespan(application):
    db.init_db()
    cycle.init_schema()
    for_each_user(engine.seed_target_weights)
    threading.Thread(target=block_worker, daemon=True).start()
    threading.Thread(target=reviewer.worker, daemon=True).start()
    threading.Thread(target=coach.prepare_worker, daemon=True).start()
    if app_config.get_bool("auto_video"):
        threading.Thread(target=auto_video_worker, daemon=True).start()
    yield


app = FastAPI(title="Workout Tracker", lifespan=lifespan)
app.include_router(coach_api.router)
app.include_router(cycle.router)

_known_users = {"time": 0.0, "ids": set()}


def known_user(user_id):
    if user_id in _known_users["ids"] and time.time() - _known_users["time"] < 30:
        return True
    _known_users["ids"] = {row["id"] for row in query_all("SELECT id FROM users")}
    _known_users["time"] = time.time()
    return user_id in _known_users["ids"]


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
async def static_revalidate(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/") and request.url.path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(db.NoUser)
async def no_user_handler(request: Request, exc):
    return JSONResponse({"detail": "Choose a user first"}, status_code=401)


def own_program(program_id):
    program = query_one("SELECT * FROM programs WHERE id = ? AND user_id = ?", (program_id, db.uid()))
    if not program:
        raise HTTPException(404, "Program not found")
    return program


def own_session(session_id):
    session = query_one("SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, db.uid()))
    if not session:
        raise HTTPException(404, "Workout not found")
    return session


def own_session_exercise(session_exercise_id):
    item = query_one(
        "SELECT se.* FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE se.id = ? AND s.user_id = ?",
        (session_exercise_id, db.uid()),
    )
    if not item:
        raise HTTPException(404, "Exercise not in this workout")
    return item


def own_set(set_id):
    row = query_one(
        "SELECT ss.* FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id JOIN sessions s ON s.id = se.session_id WHERE ss.id = ? AND s.user_id = ?",
        (set_id, db.uid()),
    )
    if not row:
        raise HTTPException(404, "Set not found")
    return row


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    measure: str = "reps"
    track_weight: bool = True
    video: Optional[str] = None
    video_start: Optional[int] = None
    video_end: Optional[int] = None
    video_title: Optional[str] = None
    notes: str = ""
    cues: str = ""
    primary_muscle: Optional[str] = None
    secondary_muscles: List[str] = []
    pattern: Optional[str] = None
    equipment: List[str] = []
    load_equipment: Optional[str] = None
    difficulty: int = Field(default=1, ge=1, le=3)


class ProgramItemIn(BaseModel):
    exercise_id: int
    sets: int = Field(ge=1, le=50)
    target: str = ""
    rep_min: Optional[float] = Field(default=None, ge=0, le=600)
    rep_max: Optional[float] = Field(default=None, ge=0, le=600)
    target_weight: Optional[float] = Field(default=None, ge=0, le=1000)
    rest_seconds: int = Field(default=90, ge=0, le=900)


class ProgramIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    weekday: Optional[int] = Field(default=None, ge=0, le=6)
    description: str = ""
    items: List[ProgramItemIn] = []


class SessionIn(BaseModel):
    day: str
    program_id: Optional[int] = None


class SetIn(BaseModel):
    session_exercise_id: int
    value: Optional[float] = None
    weight: Optional[float] = None
    effort: Optional[int] = Field(default=None, ge=1, le=3)


class SetUpdate(BaseModel):
    value: Optional[float] = None
    weight: Optional[float] = None
    effort: Optional[int] = Field(default=None, ge=1, le=3)


class SessionExerciseIn(BaseModel):
    exercise_id: int
    sets: int = Field(default=3, ge=1, le=50)
    target: str = ""
    rest_seconds: int = Field(default=90, ge=0, le=900)


class SessionStateIn(BaseModel):
    current_index: int = Field(ge=0)


class FinishIn(BaseModel):
    notes: str = ""


class PlannedIn(BaseModel):
    sets: int = Field(ge=1, le=50)


class EquipmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    key: Optional[str] = Field(default=None, max_length=40)
    category: str = "accessory"
    available: bool = True
    weights: Optional[List[float]] = None
    notes: str = ""


class SettingsIn(BaseModel):
    priority_muscles: Optional[List[str]] = None
    goal_fat_loss: Optional[bool] = None
    block_weeks: Optional[int] = Field(default=None, ge=4, le=6)
    cardio_target_min: Optional[int] = Field(default=None, ge=0, le=1000)


class BodyIn(BaseModel):
    day: str
    weight_kg: Optional[float] = Field(default=None, gt=0, lt=400)
    waist_cm: Optional[float] = Field(default=None, gt=0, lt=300)


class RedesignIn(BaseModel):
    instruction: str = ""


def validate_day(value):
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid date")


def exercise_payload(body: ExerciseIn):
    if body.measure not in MEASURES:
        raise HTTPException(400, "Invalid measure")
    if body.primary_muscle and body.primary_muscle not in catalog.MUSCLES:
        raise HTTPException(400, "Unknown muscle")
    video_id = None
    if body.video:
        video_id = youtube.extract_video_id(body.video)
        if not video_id:
            raise HTTPException(400, "Could not read a YouTube video from that link")
    start = body.video_start if body.video_start and body.video_start > 0 else None
    end = body.video_end if body.video_end and body.video_end > 0 else None
    if start and end and end <= start:
        raise HTTPException(400, "Loop end must be after loop start")
    equipment = db.equipment_map()
    keys = [key for key in body.equipment if key in equipment]
    load = body.load_equipment if body.load_equipment in equipment else None
    return {
        "name": body.name.strip(),
        "measure": body.measure,
        "track_weight": 1 if body.track_weight else 0,
        "video_id": video_id,
        "video_start": start,
        "video_end": end,
        "video_title": body.video_title,
        "notes": body.notes.strip(),
        "cues": body.cues.strip(),
        "primary_muscle": body.primary_muscle,
        "secondary_muscles": json.dumps([muscle for muscle in body.secondary_muscles if muscle in catalog.MUSCLES and muscle != body.primary_muscle]),
        "pattern": (body.pattern or "").strip() or None,
        "equipment": json.dumps(keys),
        "load_equipment": load,
        "difficulty": body.difficulty,
    }


def get_exercise(exercise_id):
    return db.exercise_row(query_one("SELECT * FROM exercises WHERE id = ?", (exercise_id,)))


@app.get("/api/meta")
def meta():
    return {"muscles": catalog.MUSCLES, "muscle_labels": engine.MUSCLE_LABELS, "measures": MEASURES}


@app.get("/api/exercises")
def list_exercises():
    rows = query_all(
        """
        SELECT e.*, (SELECT COUNT(*) FROM program_exercises pe JOIN programs p ON p.id = pe.program_id WHERE pe.exercise_id = e.id AND p.archived = 0 AND p.user_id = ?) AS program_count,
          (SELECT COUNT(*) FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE se.exercise_id = e.id AND s.user_id = ?) AS times_logged
        FROM exercises e ORDER BY e.name COLLATE NOCASE
        """,
        (db.current_user_id() or 0, db.current_user_id() or 0),
    )
    equipment = db.equipment_map()
    result = []
    for row in rows:
        item = db.exercise_row(row)
        item["available"] = engine.available_exercise(item, equipment)
        result.append(item)
    return result


@app.post("/api/exercises")
def create_exercise(body: ExerciseIn):
    data = exercise_payload(body)
    try:
        with transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO exercises (name, measure, track_weight, video_id, video_start, video_end, video_title, video_source, video_auto_tried, notes,
                  cues, primary_muscle, secondary_muscles, pattern, equipment, load_equipment, difficulty, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data["name"], data["measure"], data["track_weight"], data["video_id"], data["video_start"], data["video_end"], data["video_title"],
                    "manual" if data["video_id"] else None, 1 if data["video_id"] else 0, data["notes"], data["cues"], data["primary_muscle"],
                    data["secondary_muscles"], data["pattern"], data["equipment"], data["load_equipment"], data["difficulty"], now_iso(),
                ),
            )
            new_id = cursor.lastrowid
    except Exception as error:
        if "UNIQUE" in str(error):
            raise HTTPException(409, "An exercise with this name already exists")
        raise
    return get_exercise(new_id)


@app.put("/api/exercises/{exercise_id}")
def update_exercise(exercise_id: int, body: ExerciseIn):
    existing = query_one("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
    if not existing:
        raise HTTPException(404, "Exercise not found")
    data = exercise_payload(body)
    video_changed = data["video_id"] != existing["video_id"]
    source = existing["video_source"]
    if video_changed:
        source = "manual" if data["video_id"] else None
    title = data["video_title"] if data["video_title"] is not None else (existing["video_title"] if not video_changed else None)
    try:
        with transaction() as conn:
            conn.execute(
                """
                UPDATE exercises SET name = ?, measure = ?, track_weight = ?, video_id = ?, video_start = ?, video_end = ?, video_title = ?, video_source = ?,
                  video_auto_tried = 1, notes = ?, cues = ?, primary_muscle = ?, secondary_muscles = ?, pattern = ?, equipment = ?, load_equipment = ?, difficulty = ?
                WHERE id = ?
                """,
                (
                    data["name"], data["measure"], data["track_weight"], data["video_id"], data["video_start"], data["video_end"], title, source,
                    data["notes"], data["cues"], data["primary_muscle"], data["secondary_muscles"], data["pattern"], data["equipment"],
                    data["load_equipment"], data["difficulty"], exercise_id,
                ),
            )
    except Exception as error:
        if "UNIQUE" in str(error):
            raise HTTPException(409, "An exercise with this name already exists")
        raise
    return get_exercise(exercise_id)


@app.delete("/api/exercises/{exercise_id}")
def delete_exercise(exercise_id: int):
    existing = query_one("SELECT media_loop, media_muscles FROM exercises WHERE id = ?", (exercise_id,))
    with transaction() as conn:
        conn.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))
    if existing:
        for name in (existing["media_loop"], existing["media_muscles"]):
            remove_media_file(name)
    return {"ok": True}


def remove_media_file(name):
    if not name:
        return
    path = (db.MEDIA_DIR / name).resolve()
    if path.parent == db.MEDIA_DIR.resolve() and path.exists():
        path.unlink()


@app.post("/api/exercises/{exercise_id}/media/{kind}")
async def upload_media(exercise_id: int, kind: str, file: UploadFile = File(...)):
    if kind not in MEDIA_KINDS:
        raise HTTPException(400, "Unknown media type")
    existing = query_one("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
    if not existing:
        raise HTTPException(404, "Exercise not found")
    extension = MEDIA_TYPES.get((file.content_type or "").lower())
    if not extension:
        suffix = Path(file.filename or "").suffix.lower().replace(".jpeg", ".jpg")
        extension = suffix if suffix in MEDIA_TYPES.values() else None
    if not extension:
        raise HTTPException(400, "Allowed: GIF, PNG, JPG, WEBP, SVG, MP4, WEBM and MOV")
    content = await file.read(MAX_MEDIA_BYTES + 1)
    if len(content) > MAX_MEDIA_BYTES:
        raise HTTPException(413, "File is larger than 60 MB")
    if not content:
        raise HTTPException(400, "File is empty")
    db.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    name = str(exercise_id) + "-" + kind + "-" + secrets.token_hex(4) + extension
    (db.MEDIA_DIR / name).write_bytes(content)
    column = "media_loop" if kind == "loop" else "media_muscles"
    with transaction() as conn:
        conn.execute("UPDATE exercises SET " + column + " = ? WHERE id = ?", (name, exercise_id))
    remove_media_file(existing[column])
    return get_exercise(exercise_id)


@app.delete("/api/exercises/{exercise_id}/media/{kind}")
def delete_media(exercise_id: int, kind: str):
    if kind not in MEDIA_KINDS:
        raise HTTPException(400, "Unknown media type")
    column = "media_loop" if kind == "loop" else "media_muscles"
    existing = query_one("SELECT " + column + " AS name FROM exercises WHERE id = ?", (exercise_id,))
    if not existing:
        raise HTTPException(404, "Exercise not found")
    with transaction() as conn:
        conn.execute("UPDATE exercises SET " + column + " = NULL WHERE id = ?", (exercise_id,))
    remove_media_file(existing["name"])
    return get_exercise(exercise_id)


@app.post("/api/exercises/{exercise_id}/auto-video")
def auto_video(exercise_id: int):
    existing = query_one("SELECT * FROM exercises WHERE id = ?", (exercise_id,))
    if not existing:
        raise HTTPException(404, "Exercise not found")
    try:
        best = youtube.pick_best(existing["name"])
    except Exception:
        raise HTTPException(502, "YouTube search failed")
    if not best:
        raise HTTPException(404, "No embeddable video found")
    with transaction() as conn:
        conn.execute(
            "UPDATE exercises SET video_id = ?, video_title = ?, video_source = 'auto', video_start = NULL, video_end = NULL, video_auto_tried = 1 WHERE id = ?",
            (best["video_id"], best["title"], exercise_id),
        )
    return get_exercise(exercise_id)


@app.get("/api/youtube/search")
def youtube_search(q: str, short: bool = False):
    if not q.strip():
        return []
    try:
        results = youtube.search_with_embed_check(q.strip() + (" shorts" if short else ""))
    except Exception:
        raise HTTPException(502, "YouTube search failed")
    results.sort(key=lambda item: (not item.get("embeddable"), item.get("length") is None, item.get("length") or 0))
    return results


@app.get("/api/equipment")
def list_equipment():
    rows = sorted(db.equipment_map().values(), key=lambda row: (not row["available"], row["category"], row["name"]))
    usage = {}
    for exercise in engine.library_exercises():
        for key in exercise["equipment"]:
            usage[key] = usage.get(key, 0) + 1
    for row in rows:
        row["exercise_count"] = usage.get(row["key"], 0)
    return rows


def equipment_key(name):
    base = "".join(char if char.isalnum() else "_" for char in name.lower()).strip("_")[:30] or "item"
    key = base
    counter = 2
    while query_one("SELECT 1 FROM equipment WHERE key = ?", (key,)):
        key = base + "_" + str(counter)
        counter += 1
    return key


def clean_weights(weights):
    if not weights:
        return None
    values = sorted({round(float(value), 2) for value in weights if 0 < float(value) < 1000})
    return json.dumps(values) if values else None


@app.post("/api/equipment")
def create_equipment(body: EquipmentIn):
    key = equipment_key(body.key or body.name)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO equipment (key, name, category, available, weights, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (key, body.name.strip(), body.category, 1 if body.available else 0, clean_weights(body.weights), body.notes.strip(), now_iso()),
        )
    return db.equipment_map()[key]


@app.put("/api/equipment/{key}")
def update_equipment(key: str, body: EquipmentIn):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    with transaction() as conn:
        conn.execute(
            "UPDATE equipment SET name = ?, category = ?, available = ?, weights = ?, notes = ? WHERE key = ?",
            (body.name.strip(), body.category, 1 if body.available else 0, clean_weights(body.weights), body.notes.strip(), key),
        )
    result = db.equipment_map()[key]
    result["swapped"], result["pending"] = replace_unavailable()
    return result


def replace_unavailable():
    swapped = []
    pending = None
    for user in query_all("SELECT id FROM users WHERE status = 'ready'"):
        with db.as_user(user["id"]):
            try:
                swapped.extend(engine.fix_unavailable_items())
            except engine.AIUnavailable as error:
                pending = "Replacements will run as soon as the AI coach is ready (" + str(error) + ")."
    return swapped, pending


@app.delete("/api/equipment/{key}")
def delete_equipment(key: str):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    with transaction() as conn:
        conn.execute("DELETE FROM equipment WHERE key = ?", (key,))
    remove_media_file(existing.get("photo"))
    swapped, pending = replace_unavailable()
    return {"ok": True, "swapped": swapped, "pending": pending}


@app.post("/api/equipment/{key}/photo")
async def upload_equipment_photo(key: str, file: UploadFile = File(...)):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    extension = MEDIA_TYPES.get((file.content_type or "").lower())
    if not extension or not extension in (".png", ".jpg", ".webp", ".gif", ".svg"):
        suffix = Path(file.filename or "").suffix.lower().replace(".jpeg", ".jpg")
        extension = suffix if suffix in (".png", ".jpg", ".webp", ".gif", ".svg", ".heic") else None
    if not extension:
        raise HTTPException(400, "Allowed: PNG, JPG, WEBP, GIF, SVG")
    content = await file.read(MAX_MEDIA_BYTES + 1)
    if len(content) > MAX_MEDIA_BYTES:
        raise HTTPException(413, "File is larger than 60 MB")
    if not content:
        raise HTTPException(400, "File is empty")
    name = "equipment-" + key + "-" + secrets.token_hex(4) + extension
    (db.MEDIA_DIR / name).write_bytes(content)
    with transaction() as conn:
        conn.execute("UPDATE equipment SET photo = ? WHERE key = ?", (name, key))
    remove_media_file(existing["photo"])
    return db.equipment_map()[key]


@app.delete("/api/equipment/{key}/photo")
def delete_equipment_photo(key: str):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    with transaction() as conn:
        conn.execute("UPDATE equipment SET photo = NULL WHERE key = ?", (key,))
    remove_media_file(existing["photo"])
    return db.equipment_map()[key]


def load_program(program_id):
    program = query_one("SELECT * FROM programs WHERE id = ? AND user_id = ?", (program_id, db.uid()))
    if not program:
        return None
    program["items"] = query_all(
        """
        SELECT pe.id, pe.exercise_id, pe.position, pe.sets, pe.target, pe.rest_seconds, pe.rep_min, pe.rep_max, pe.target_weight, pe.added_block, pe.cue,
               e.name, e.measure, e.track_weight, e.video_id, e.primary_muscle, e.media_loop, e.equipment
        FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id
        WHERE pe.program_id = ? ORDER BY pe.position
        """,
        (program_id,),
    )
    for item in program["items"]:
        item["track_weight"] = bool(item["track_weight"])
        item["equipment"] = json.loads(item["equipment"] or "[]")
    program["last_done"] = last_done_for(program_id)
    program["total_sets"] = sum(item["sets"] for item in program["items"] if item["measure"] not in ("min", "none"))
    return program


def last_done_for(program_id):
    row = query_one("SELECT MAX(day) AS day FROM sessions WHERE program_id = ? AND status = 'done' AND user_id = ?", (program_id, db.uid()))
    return row["day"] if row else None


@app.get("/api/programs")
def list_programs():
    ids = query_all("SELECT id FROM programs WHERE archived = 0 AND user_id = ? ORDER BY COALESCE(weekday, 99), name", (db.uid(),))
    return [load_program(row["id"]) for row in ids]


@app.get("/api/programs/{program_id}")
def get_program(program_id: int):
    program = load_program(program_id)
    if not program:
        raise HTTPException(404, "Program not found")
    program["versions"] = query_all(
        "SELECT id, created_at, reason FROM program_versions WHERE program_id = ? ORDER BY id DESC LIMIT 20", (program_id,)
    )
    return program


def write_program_items(conn, program_id, items, block_number):
    previous = {
        row["exercise_id"]: dict(row) for row in conn.execute(
            "SELECT exercise_id, target_weight, miss_count, hit_count, added_block, cue FROM program_exercises WHERE program_id = ?", (program_id,)
        ).fetchall()
    }
    conn.execute("DELETE FROM program_exercises WHERE program_id = ?", (program_id,))
    for position, item in enumerate(items):
        exercise = conn.execute("SELECT measure FROM exercises WHERE id = ?", (item.exercise_id,)).fetchone()
        if not exercise:
            raise HTTPException(400, "Unknown exercise in program")
        rep_min, rep_max = item.rep_min, item.rep_max
        if rep_min is None and rep_max is None and item.target:
            rep_min, rep_max = db.parse_target(item.target)
        if rep_min is not None and rep_max is not None and rep_max < rep_min:
            rep_min, rep_max = rep_max, rep_min
        if rep_max is None:
            rep_max = rep_min
        old = previous.get(item.exercise_id, {})
        target_weight = item.target_weight if item.target_weight is not None else old.get("target_weight")
        target = db.build_target(rep_min, rep_max, exercise["measure"], item.target.strip())
        conn.execute(
            """
            INSERT INTO program_exercises (program_id, exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, target_weight, miss_count, hit_count, added_block, cue)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                program_id, item.exercise_id, position, item.sets, target, item.rest_seconds, rep_min, rep_max, target_weight,
                old.get("miss_count", 0), old.get("hit_count", 0), old.get("added_block", block_number), old.get("cue", "") or "",
            ),
        )


@app.post("/api/programs")
def create_program(body: ProgramIn):
    block = engine.ensure_block()
    with transaction() as conn:
        cursor = conn.execute(
            "INSERT INTO programs (user_id, name, weekday, description, created_at) VALUES (?, ?, ?, ?, ?)",
            (db.uid(), body.name.strip(), body.weekday, body.description.strip(), now_iso()),
        )
        program_id = cursor.lastrowid
        write_program_items(conn, program_id, body.items, block["number"])
    return load_program(program_id)


@app.put("/api/programs/{program_id}")
def update_program(program_id: int, body: ProgramIn):
    if not query_one("SELECT id FROM programs WHERE id = ? AND user_id = ?", (program_id, db.uid())):
        raise HTTPException(404, "Program not found")
    block = engine.ensure_block()
    with transaction() as conn:
        version = db.snapshot_program(conn, program_id, "Manual edit")
        conn.execute(
            "UPDATE programs SET name = ?, weekday = ?, description = ? WHERE id = ?",
            (body.name.strip(), body.weekday, body.description.strip(), program_id),
        )
        write_program_items(conn, program_id, body.items, block["number"])
        db.log_event(conn, "manual", "edit", body.name.strip() + " edited", "Manual change in the program editor.", program_id, None, block["id"],
                     source="manual", version_id=version)
    return load_program(program_id)


@app.post("/api/programs/{program_id}/duplicate")
def duplicate_program(program_id: int):
    program = load_program(program_id)
    if not program:
        raise HTTPException(404, "Program not found")
    body = ProgramIn(
        name=program["name"] + " copy", weekday=None, description=program["description"],
        items=[ProgramItemIn(exercise_id=item["exercise_id"], sets=item["sets"], target=item["target"], rep_min=item["rep_min"], rep_max=item["rep_max"],
                             target_weight=item["target_weight"], rest_seconds=item["rest_seconds"]) for item in program["items"]],
    )
    return create_program(body)


@app.delete("/api/programs/{program_id}")
def delete_program(program_id: int):
    own_program(program_id)
    with transaction() as conn:
        used = conn.execute("SELECT 1 FROM sessions WHERE program_id = ? LIMIT 1", (program_id,)).fetchone()
        if used:
            conn.execute("UPDATE programs SET archived = 1 WHERE id = ?", (program_id,))
        else:
            conn.execute("DELETE FROM programs WHERE id = ?", (program_id,))
    return {"ok": True}


@app.post("/api/programs/{program_id}/restore/{version_id}")
def restore_version(program_id: int, version_id: int):
    own_program(program_id)
    version = query_one("SELECT * FROM program_versions WHERE id = ? AND program_id = ?", (version_id, program_id))
    if not version:
        raise HTTPException(404, "Version not found")
    block = engine.ensure_block()
    with transaction() as conn:
        backup = db.snapshot_program(conn, program_id, "Before restore")
        db.restore_program(conn, version_id)
        db.log_event(conn, "manual", "restore", "Version from " + version["created_at"][:10] + " restored", version["reason"],
                     program_id, None, block["id"], source="manual", version_id=backup)
    return load_program(program_id)


@app.get("/api/suggestions")
def suggestions(day: str):
    day = validate_day(day)
    weekday = date.fromisoformat(day).weekday()
    programs = list_programs()
    ranked = []
    for program in programs:
        row = query_one(
            "SELECT MAX(day) AS day, COUNT(*) AS total FROM sessions WHERE program_id = ? AND status = 'done' AND day < ? AND user_id = ?",
            (program["id"], day, db.uid()),
        )
        last_before = row["day"] if row else None
        days_since = (date.fromisoformat(day) - date.fromisoformat(last_before)).days if last_before else None
        ranked.append({
            "program": program,
            "last_done_before": last_before,
            "days_since": days_since,
            "times_done": row["total"] if row else 0,
            "matches_weekday": program["weekday"] == weekday,
        })
    ranked.sort(key=lambda entry: (
        0 if entry["matches_weekday"] and (entry["days_since"] is None or entry["days_since"] >= 4) else 1,
        0 if entry["last_done_before"] is None else 1,
        entry["last_done_before"] or "",
        entry["program"]["weekday"] if entry["program"]["weekday"] is not None else 99,
    ))
    for index, entry in enumerate(ranked):
        entry["suggested"] = index == 0
        if entry["matches_weekday"]:
            entry["reason"] = "Today in your weekly plan"
        elif entry["last_done_before"] is None:
            entry["reason"] = "Not done yet"
        else:
            entry["reason"] = "Last done " + str(entry["days_since"]) + " days ago"
    block = engine.ensure_block(day)
    return {"day": day, "weekday": weekday, "options": ranked, "block": engine.block_state(block, day)}


SESSION_LIST_SQL = """
    SELECT s.*,
      (SELECT COUNT(*) FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id WHERE se.session_id = s.id) AS sets_done,
      (SELECT COALESCE(SUM(se.planned_sets), 0) FROM session_exercises se WHERE se.session_id = s.id) AS sets_planned,
      (SELECT COALESCE(SUM(ss.value * ss.weight), 0) FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id
         WHERE se.session_id = s.id AND se.measure = 'reps' AND ss.weight IS NOT NULL AND ss.value IS NOT NULL) AS volume
    FROM sessions s
"""


@app.get("/api/sessions")
def list_sessions(start: Optional[str] = None, end: Optional[str] = None, limit: int = 500):
    sql = SESSION_LIST_SQL
    params = [db.uid()]
    clauses = ["s.user_id = ?"]
    if start:
        clauses.append("s.day >= ?")
        params.append(validate_day(start))
    if end:
        clauses.append("s.day <= ?")
        params.append(validate_day(end))
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY s.day DESC, s.started_at DESC LIMIT ?"
    params.append(max(1, min(limit, 5000)))
    return query_all(sql, params)


@app.get("/api/sessions/active")
def active_session():
    row = query_one("SELECT id FROM sessions WHERE status = 'active' AND user_id = ? ORDER BY started_at DESC LIMIT 1", (db.uid(),))
    if not row:
        return None
    return load_session(row["id"])


def previous_sets(exercise_id, session_id):
    if exercise_id is None:
        return None
    previous = query_one(
        """
        SELECT se.id, s.day FROM session_exercises se JOIN sessions s ON s.id = se.session_id
        WHERE se.exercise_id = ? AND s.status = 'done' AND s.id != ? AND s.user_id = ?
          AND EXISTS (SELECT 1 FROM session_sets ss WHERE ss.session_exercise_id = se.id)
        ORDER BY s.day DESC, s.started_at DESC LIMIT 1
        """,
        (exercise_id, session_id, db.uid()),
    )
    if not previous:
        return None
    sets = query_all(
        "SELECT set_number, value, weight, effort FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number",
        (previous["id"],),
    )
    return {"day": previous["day"], "sets": sets}


def best_metric(exercise_id, session_id):
    row = query_one("SELECT measure, track_weight FROM exercises WHERE id = ?", (exercise_id,))
    if not row:
        return None
    history = [entry for entry in engine.exercise_exposures(exercise_id) if entry["session_id"] != session_id]
    return max((entry["metric"] for entry in history), default=None)


def load_session(session_id):
    session = query_one("SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, db.uid()))
    if not session:
        return None
    exercises = query_all(
        """
        SELECT se.*, e.video_id, e.video_start, e.video_end, e.notes AS exercise_notes, e.cues, e.media_loop, e.media_muscles,
               e.primary_muscle, e.secondary_muscles, e.load_equipment, pe.cue AS plan_cue
        FROM session_exercises se LEFT JOIN exercises e ON e.id = se.exercise_id LEFT JOIN program_exercises pe ON pe.id = se.program_exercise_id
        WHERE se.session_id = ? ORDER BY se.position
        """,
        (session_id,),
    )
    equipment = db.equipment_map()
    for item in exercises:
        item["track_weight"] = bool(item["track_weight"])
        item["secondary_muscles"] = json.loads(item["secondary_muscles"] or "[]")
        item["sets"] = query_all(
            "SELECT id, set_number, value, weight, effort, done_at FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number",
            (item["id"],),
        )
        item["previous"] = previous_sets(item["exercise_id"], session_id)
        item["best"] = best_metric(item["exercise_id"], session_id) if item["exercise_id"] else None
        load = item.get("load_equipment")
        item["weight_steps"] = equipment[load]["weights"] if load and load in equipment else None
    session["exercises"] = exercises
    return session


def insert_session_exercise(conn, session_id, position, exercise, sets, target, rest, deload, program_item=None):
    planned = max(1, (sets + 1) // 2) if deload and exercise["measure"] not in ("min", "none") else sets
    conn.execute(
        """
        INSERT INTO session_exercises (session_id, exercise_id, exercise_name, measure, track_weight, position, planned_sets, target, rest_seconds,
          program_exercise_id, rep_min, rep_max, target_weight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id, exercise["id"], exercise["name"], exercise["measure"], 1 if exercise["track_weight"] else 0, position, planned, target, rest,
            program_item["id"] if program_item else None, program_item["rep_min"] if program_item else None,
            program_item["rep_max"] if program_item else None, program_item["target_weight"] if program_item else None,
        ),
    )


@app.post("/api/sessions")
def start_session(body: SessionIn):
    day = validate_day(body.day)
    if query_one("SELECT id FROM sessions WHERE status = 'active' AND user_id = ? LIMIT 1", (db.uid(),)):
        raise HTTPException(409, "Another workout is still in progress")
    program = None
    if body.program_id is not None:
        program = load_program(body.program_id)
        if not program:
            raise HTTPException(404, "Program not found")
    block = engine.ensure_block(day)
    state = engine.block_state(block, day)
    cycle_adjusted = False
    if program:
        program, cycle_adjusted = cycle.apply_to_program(program, day)
    with transaction() as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (user_id, day, program_id, program_name, started_at, block_id, block_week, deload, cycle_adjusted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (db.uid(), day, program["id"] if program else None, program["name"] if program else "Free workout", now_iso(), block["id"], state["week"],
             1 if state["deload"] else 0, 1 if cycle_adjusted else 0),
        )
        session_id = cursor.lastrowid
        if program:
            for position, item in enumerate(program["items"]):
                exercise = {"id": item["exercise_id"], "name": item["name"], "measure": item["measure"], "track_weight": item["track_weight"]}
                insert_session_exercise(conn, session_id, position, exercise, item["sets"], item["target"], item["rest_seconds"], state["deload"] and not cycle_adjusted, item)
    return load_session(session_id)


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int):
    session = load_session(session_id)
    if not session:
        raise HTTPException(404, "Workout not found")
    return session


@app.post("/api/sessions/{session_id}/exercises")
def add_session_exercise(session_id: int, body: SessionExerciseIn):
    own_session(session_id)
    exercise = get_exercise(body.exercise_id)
    if not exercise:
        raise HTTPException(404, "Exercise not found")
    with transaction() as conn:
        row = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM session_exercises WHERE session_id = ?", (session_id,)).fetchone()
        insert_session_exercise(conn, session_id, row["next"], exercise, body.sets, body.target.strip(), body.rest_seconds, False)
    return load_session(session_id)


@app.delete("/api/session-exercises/{session_exercise_id}")
def remove_session_exercise(session_exercise_id: int):
    own_session_exercise(session_exercise_id)
    with transaction() as conn:
        conn.execute("DELETE FROM session_exercises WHERE id = ?", (session_exercise_id,))
    return {"ok": True}


@app.put("/api/session-exercises/{session_exercise_id}/planned")
def change_planned_sets(session_exercise_id: int, body: PlannedIn):
    own_session_exercise(session_exercise_id)
    with transaction() as conn:
        conn.execute("UPDATE session_exercises SET planned_sets = ? WHERE id = ?", (body.sets, session_exercise_id))
    return {"ok": True}


@app.post("/api/sets")
def log_set(body: SetIn):
    item = own_session_exercise(body.session_exercise_id)
    with transaction() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(set_number), 0) + 1 AS next FROM session_sets WHERE session_exercise_id = ?",
            (body.session_exercise_id,),
        ).fetchone()
        cursor = conn.execute(
            "INSERT INTO session_sets (session_exercise_id, set_number, value, weight, effort, done_at) VALUES (?, ?, ?, ?, ?, ?)",
            (body.session_exercise_id, row["next"], body.value, body.weight, body.effort, now_iso()),
        )
        new_id = cursor.lastrowid
    result = query_one("SELECT * FROM session_sets WHERE id = ?", (new_id,))
    record = None
    if item["exercise_id"]:
        previous_best = best_metric(item["exercise_id"], item["session_id"])
        current = engine.set_metric(item["measure"], bool(item["track_weight"]), [result])
        if current and previous_best and current > previous_best + 1e-6:
            record = {"previous": previous_best, "current": current}
    result["record"] = record
    return result


@app.put("/api/sets/{set_id}")
def update_set(set_id: int, body: SetUpdate):
    own_set(set_id)
    with transaction() as conn:
        conn.execute("UPDATE session_sets SET value = ?, weight = ?, effort = ? WHERE id = ?", (body.value, body.weight, body.effort, set_id))
    return query_one("SELECT * FROM session_sets WHERE id = ?", (set_id,))


@app.delete("/api/sets/{set_id}")
def delete_set(set_id: int):
    own_set(set_id)
    with transaction() as conn:
        row = conn.execute("SELECT session_exercise_id FROM session_sets WHERE id = ?", (set_id,)).fetchone()
        conn.execute("DELETE FROM session_sets WHERE id = ?", (set_id,))
        if row:
            remaining = conn.execute(
                "SELECT id FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number",
                (row["session_exercise_id"],),
            ).fetchall()
            for number, remaining_row in enumerate(remaining, start=1):
                conn.execute("UPDATE session_sets SET set_number = ? WHERE id = ?", (number, remaining_row["id"]))
    return {"ok": True}


@app.put("/api/sessions/{session_id}/state")
def save_state(session_id: int, body: SessionStateIn):
    own_session(session_id)
    with transaction() as conn:
        conn.execute("UPDATE sessions SET current_index = ? WHERE id = ?", (body.current_index, session_id))
    return {"ok": True}


@app.post("/api/sessions/{session_id}/finish")
def finish_session(session_id: int, body: FinishIn):
    own_session(session_id)
    with transaction() as conn:
        conn.execute(
            "UPDATE sessions SET status = 'done', finished_at = ?, notes = ?, adapted = 0 WHERE id = ?",
            (now_iso(), body.notes.strip(), session_id),
        )
    changes = engine.process_session(session_id)
    user_id = db.uid()

    def write_note():
        with db.as_user(user_id):
            engine.session_note(session_id)

    threading.Thread(target=write_note, daemon=True).start()
    coach.start_outro(user_id, session_id)
    session = load_session(session_id)
    session["changes"] = changes
    return session


@app.post("/api/sessions/{session_id}/reopen")
def reopen_session(session_id: int):
    own_session(session_id)
    if query_one("SELECT id FROM sessions WHERE status = 'active' AND id != ? AND user_id = ? LIMIT 1", (session_id, db.uid())):
        raise HTTPException(409, "Another workout is still in progress")
    with transaction() as conn:
        conn.execute("UPDATE sessions SET status = 'active', finished_at = NULL WHERE id = ?", (session_id,))
    return load_session(session_id)


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int):
    own_session(session_id)
    with transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return {"ok": True}


@app.get("/api/exercises/{exercise_id}/history")
def exercise_history(exercise_id: int):
    exercise = get_exercise(exercise_id)
    if not exercise:
        raise HTTPException(404, "Exercise not found")
    entries = query_all(
        """
        SELECT se.id, s.id AS session_id, s.day, s.program_name, se.measure, se.track_weight, s.deload
        FROM session_exercises se JOIN sessions s ON s.id = se.session_id
        WHERE se.exercise_id = ? AND s.status = 'done' AND s.user_id = ?
          AND EXISTS (SELECT 1 FROM session_sets ss WHERE ss.session_exercise_id = se.id)
        ORDER BY s.day DESC, s.started_at DESC
        """,
        (exercise_id, db.uid()),
    )
    for entry in entries:
        entry["sets"] = query_all(
            "SELECT set_number, value, weight, effort FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number",
            (entry["id"],),
        )
        entry["metric"] = engine.set_metric(entry["measure"], bool(entry["track_weight"]), entry["sets"])
        weights = [item["weight"] for item in entry["sets"] if item["weight"]]
        entry["top_weight"] = max(weights) if weights else None
        entry["volume"] = sum((item["weight"] or 0) * (item["value"] or 0) for item in entry["sets"])
    return {"exercise": exercise, "entries": entries}


def week_key(day_value):
    return (day_value - timedelta(days=day_value.weekday())).isoformat()


@app.get("/api/dashboard")
def dashboard(today: Optional[str] = None):
    today_value = date.fromisoformat(validate_day(today)) if today else date.today()
    sessions = query_all(SESSION_LIST_SQL + " WHERE s.status = 'done' AND s.user_id = ? ORDER BY s.day", (db.uid(),))
    days = sorted({row["day"] for row in sessions})
    week_start = today_value - timedelta(days=today_value.weekday())
    this_week = sum(1 for row in sessions if date.fromisoformat(row["day"]) >= week_start)
    month_prefix = today_value.isoformat()[:7]
    this_month = sum(1 for row in sessions if row["day"].startswith(month_prefix))

    weeks_with_training = {week_key(date.fromisoformat(value)) for value in days}
    streak = 0
    cursor = week_start if week_start.isoformat() in weeks_with_training else week_start - timedelta(days=7)
    while cursor.isoformat() in weeks_with_training:
        streak += 1
        cursor -= timedelta(days=7)

    heat = {}
    for row in sessions:
        entry = heat.setdefault(row["day"], {"day": row["day"], "count": 0, "sets": 0, "volume": 0})
        entry["count"] += 1
        entry["sets"] += row["sets_done"]
        entry["volume"] += row["volume"] or 0

    weekly = {}
    for row in sessions:
        key = week_key(date.fromisoformat(row["day"]))
        bucket = weekly.setdefault(key, {"week": key, "workouts": 0, "volume": 0, "sets": 0})
        bucket["workouts"] += 1
        bucket["volume"] += row["volume"] or 0
        bucket["sets"] += row["sets_done"]

    strength = []
    exercises = query_all(
        """
        SELECT DISTINCT e.id, e.name, e.primary_muscle FROM exercises e JOIN session_exercises se ON se.exercise_id = e.id
        JOIN sessions s ON s.id = se.session_id WHERE s.status = 'done' AND e.measure = 'reps' AND e.track_weight = 1 AND s.user_id = ?
        """,
        (db.uid(),),
    )
    for exercise in exercises:
        points = [entry for entry in engine.exercise_exposures(exercise["id"]) if entry["top_weight"]]
        if not points:
            continue
        series = [{"day": entry["day"], "e1rm": round(entry["metric"], 1), "weight": entry["top_weight"], "deload": entry["deload"]} for entry in points]
        first, last = series[0]["e1rm"], series[-1]["e1rm"]
        strength.append({
            "id": exercise["id"], "name": exercise["name"], "muscle": exercise["primary_muscle"], "series": series,
            "first": first, "last": last, "best": max(point["e1rm"] for point in series),
            "change": (last / first - 1) if first else 0, "count": len(series),
        })
    strength.sort(key=lambda entry: (-entry["count"], entry["name"]))

    index_by_week = {}
    for entry in strength:
        base = entry["series"][0]["e1rm"]
        if not base:
            continue
        latest = {}
        for point in entry["series"]:
            latest[week_key(date.fromisoformat(point["day"]))] = point["e1rm"] / base * 100
        for key, value in latest.items():
            index_by_week.setdefault(key, []).append(value)
    strength_index = [{"week": key, "value": round(sum(values) / len(values), 1), "n": len(values)} for key, values in sorted(index_by_week.items())]

    prs = []
    since = (today_value - timedelta(days=30)).isoformat()
    for entry in strength:
        best_so_far = None
        for point in entry["series"]:
            if best_so_far is not None and point["e1rm"] > best_so_far and point["day"] >= since:
                prs.append({"name": entry["name"], "day": point["day"], "e1rm": point["e1rm"], "weight": point["weight"], "gain": point["e1rm"] - best_so_far})
            best_so_far = point["e1rm"] if best_so_far is None else max(best_so_far, point["e1rm"])
    prs.sort(key=lambda entry: entry["day"], reverse=True)

    config = engine.settings()
    planned_volume, _ = engine.muscle_volume()
    targets = engine.volume_targets(config["priority"])
    done_volume = {}
    week_ago = (today_value - timedelta(days=6)).isoformat()
    rows = query_all(
        """
        SELECT e.primary_muscle, e.secondary_muscles, COUNT(ss.id) AS sets FROM session_sets ss
        JOIN session_exercises se ON se.id = ss.session_exercise_id JOIN sessions s ON s.id = se.session_id
        JOIN exercises e ON e.id = se.exercise_id
        WHERE s.day >= ? AND s.day <= ? AND se.measure IN ('reps', 'sec') AND s.user_id = ? GROUP BY se.id
        """,
        (week_ago, today_value.isoformat(), db.uid()),
    )
    for row in rows:
        if row["primary_muscle"]:
            done_volume[row["primary_muscle"]] = done_volume.get(row["primary_muscle"], 0) + row["sets"]
        for muscle in json.loads(row["secondary_muscles"] or "[]"):
            done_volume[muscle] = done_volume.get(muscle, 0) + row["sets"] * 0.5
    volume = []
    for muscle, (low, high) in targets.items():
        planned = planned_volume.get(muscle, 0)
        done = done_volume.get(muscle, 0)
        if planned == 0 and done == 0:
            continue
        volume.append({"muscle": muscle, "label": engine.MUSCLE_LABELS[muscle], "planned": planned, "done": done, "min": low, "max": high,
                       "priority": muscle in config["priority"]})
    volume.sort(key=lambda entry: (not entry["priority"], -entry["planned"]))

    cardio = query_one(
        """
        SELECT COALESCE(SUM(ss.value), 0) AS minutes FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id
        JOIN sessions s ON s.id = se.session_id WHERE se.measure = 'min' AND s.day >= ? AND s.day <= ? AND s.user_id = ?
        """,
        (week_ago, today_value.isoformat(), db.uid()),
    )["minutes"]

    body = query_all("SELECT day, weight_kg, waist_cm FROM body_metrics WHERE user_id = ? ORDER BY day", (db.uid(),))
    block = engine.ensure_block(today_value)
    log = query_all("SELECT * FROM coach_log WHERE user_id = ? ORDER BY id DESC LIMIT 8", (db.uid(),))
    return {
        "stats": {"total": len(sessions), "this_week": this_week, "this_month": this_month, "streak_weeks": streak, "last_day": days[-1] if days else None},
        "heatmap": list(heat.values()),
        "weekly": [weekly[key] for key in sorted(weekly)][-26:],
        "strength": strength,
        "strength_index": strength_index,
        "prs": prs[:8],
        "volume": volume,
        "cardio": {"minutes": cardio, "target": config["cardio_target"]},
        "body": body,
        "body_trend": engine.bodyweight_trend(today_value),
        "block": engine.block_state(block, today_value),
        "log": log,
        "goals": {"priority": config["priority"], "fat_loss": config["fat_loss"]},
    }


@app.get("/api/stats")
def stats(today: Optional[str] = None):
    data = dashboard(today)
    return data["stats"]


@app.get("/api/body")
def list_body():
    return {"entries": query_all("SELECT day, weight_kg, waist_cm FROM body_metrics WHERE user_id = ? ORDER BY day", (db.uid(),)), "trend": engine.bodyweight_trend()}


@app.put("/api/body")
def save_body(body: BodyIn):
    day = validate_day(body.day)
    with transaction() as conn:
        if body.weight_kg is None and body.waist_cm is None:
            conn.execute("DELETE FROM body_metrics WHERE day = ? AND user_id = ?", (day, db.uid()))
        else:
            conn.execute(
                "INSERT INTO body_metrics (user_id, day, weight_kg, waist_cm) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET weight_kg = excluded.weight_kg, waist_cm = excluded.waist_cm",
                (db.uid(), day, body.weight_kg, body.waist_cm),
            )
    return list_body()


def coach_settings():
    return {
        "priority_muscles": db.get_user_json_setting("priority_muscles", catalog.DEFAULT_PRIORITY_MUSCLES),
        "goal_fat_loss": db.get_user_setting("goal_fat_loss") == "1",
        "block_weeks": int(db.get_user_setting("block_weeks") or 5),
        "cardio_target_min": int(db.get_user_setting("cardio_target_min") or 150),
        "ai_model": ai.config()["model"],
        "ollama_url": ai.config()["url"],
        "ai_provider": ai.provider(),
    }


@app.get("/api/coach")
def coach_state(log_limit: int = 60):
    block = engine.ensure_block()
    blocks = query_all("SELECT * FROM blocks WHERE user_id = ? ORDER BY number DESC LIMIT 12", (db.uid(),))
    log = query_all(
        """
        SELECT c.*, p.name AS program_name FROM coach_log c LEFT JOIN programs p ON p.id = c.program_id
        WHERE c.user_id = ? ORDER BY c.id DESC LIMIT ?
        """,
        (db.uid(), max(1, min(log_limit, 500))),
    )
    pending = query_one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'done' AND adapted = 0 AND user_id = ?", (db.uid(),))["n"]
    return {
        "block": engine.block_state(block),
        "blocks": blocks,
        "settings": coach_settings(),
        "log": log,
        "pending_sessions": pending,
        "volume_targets": engine.VOLUME_TARGETS,
    }


@app.get("/api/ai/status")
def ai_status(fresh: bool = False):
    state = ai.status(max_age=0 if fresh else 15)
    state["message"] = ai.describe(state)
    return state


@app.put("/api/coach/settings")
def update_settings(body: SettingsIn):
    with transaction() as conn:
        if body.priority_muscles is not None:
            db.set_user_setting(conn, "priority_muscles", json.dumps([muscle for muscle in body.priority_muscles if muscle in catalog.MUSCLES]))
        if body.goal_fat_loss is not None:
            db.set_user_setting(conn, "goal_fat_loss", "1" if body.goal_fat_loss else "0")
        if body.block_weeks is not None:
            db.set_user_setting(conn, "block_weeks", body.block_weeks)
        if body.cardio_target_min is not None:
            db.set_user_setting(conn, "cardio_target_min", body.cardio_target_min)
    return coach_settings()


@app.post("/api/coach/progress")
def coach_progress():
    return engine.run_pending_progression()


@app.post("/api/coach/review")
def coach_review():
    try:
        return {"summary": engine.force_review()}
    except engine.AIUnavailable as error:
        raise HTTPException(503, "The AI coach is not ready: " + str(error))


@app.post("/api/coach/deload")
def coach_deload():
    started = engine.start_deload("Triggered manually.", manual=True)
    return {"started": started}


@app.post("/api/coach/fatigue")
def coach_fatigue():
    return engine.register_fatigue()


@app.post("/api/coach/redesign/{program_id}")
def coach_redesign(program_id: int, body: RedesignIn):
    try:
        return engine.redesign_program(program_id, body.instruction)
    except engine.AIUnavailable as error:
        raise HTTPException(503, "The AI coach is not ready: " + str(error))
    except ValueError as error:
        raise HTTPException(422, "Redesign failed: " + str(error))
    except Exception as error:
        raise HTTPException(502, "AI not reachable or answer invalid: " + str(error)[:200])


@app.post("/api/coach/log/{log_id}/undo")
def coach_undo(log_id: int):
    if not engine.undo(log_id):
        raise HTTPException(400, "This change cannot be undone")
    return {"ok": True}


class OnboardingIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    sex: str = Field(pattern="^(male|female)$")
    age: Optional[int] = Field(default=None, ge=12, le=100)
    height_cm: Optional[float] = Field(default=None, ge=120, le=230)
    weight_kg: Optional[float] = Field(default=None, ge=30, le=300)
    experience: str = Field(pattern="^(none|under_6_months|6_to_24_months|over_2_years)$")
    trained_recently: bool = False
    goal: str = Field(pattern="^(health|fat_loss|muscle|strength|tone)$")
    days_per_week: int = Field(ge=1, le=7)
    session_minutes: int = Field(default=60, ge=20, le=120)
    priority_muscles: List[str] = []
    limitations: str = Field(default="", max_length=600)
    coach: Optional[str] = Field(default=None, pattern="^(max|lena)$")


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    age: Optional[int] = Field(default=None, ge=12, le=100)
    height_cm: Optional[float] = Field(default=None, ge=120, le=230)
    weight_kg: Optional[float] = Field(default=None, ge=30, le=300)
    color: Optional[str] = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")
    coach: Optional[str] = Field(default=None, pattern="^(max|lena)$")


USER_PUBLIC = "id, name, sex, color, status, status_message, created_at, last_seen, goal, days_per_week, coach, is_superuser"


def user_public(row):
    stats = query_one(
        "SELECT COUNT(*) AS workouts, MAX(day) AS last_day FROM sessions WHERE user_id = ? AND status = 'done'", (row["id"],)
    )
    row.update(stats)
    return row


@app.get("/api/users")
def list_users():
    rows = query_all("SELECT " + USER_PUBLIC + " FROM users ORDER BY COALESCE(last_seen, created_at) DESC")
    return [user_public(row) for row in rows]


@app.post("/api/users")
def create_user(body: OnboardingIn):
    name = " ".join(body.name.split())
    if query_one("SELECT id FROM users WHERE name = ?", (name,)):
        raise HTTPException(409, "This name is already taken")
    count = query_one("SELECT COUNT(*) AS n FROM users")["n"]
    first_admin = query_one("SELECT id FROM users WHERE is_superuser = 1") is None
    priority = [muscle for muscle in body.priority_muscles if muscle in catalog.MUSCLES and muscle not in catalog.NON_HYPERTROPHY_MUSCLES]
    with transaction() as conn:
        user_id = conn.execute(
            """
            INSERT INTO users (name, sex, age, height_cm, weight_kg, experience, trained_recently, goal, days_per_week, session_minutes,
              priority_muscles, limitations, color, status, status_message, created_at, last_seen, coach)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', 'Starting', ?, ?, ?)
            """,
            (
                name, body.sex, body.age, body.height_cm, body.weight_kg, body.experience, 1 if body.trained_recently else 0, body.goal,
                body.days_per_week, body.session_minutes, json.dumps(priority), body.limitations.strip(), db.USER_COLORS[count % len(db.USER_COLORS)],
                now_iso(), now_iso(), body.coach or ("lena" if body.sex == "female" else "max"),
            ),
        ).lastrowid
        if first_admin:
            conn.execute("UPDATE users SET is_superuser = 1 WHERE id = ?", (user_id,))
        if body.weight_kg:
            conn.execute("INSERT INTO body_metrics (user_id, day, weight_kg) VALUES (?, ?, ?)", (user_id, date.today().isoformat(), body.weight_kg))
    _known_users["time"] = 0
    onboarding.start_async(user_id)
    return get_user(user_id)


def get_user(user_id):
    row = query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(404, "User not found")
    row["priority_muscles"] = json.loads(row["priority_muscles"] or "[]")
    row["trained_recently"] = bool(row["trained_recently"])
    row["is_superuser"] = bool(row.get("is_superuser"))
    row["level"] = planner.derive_level(row["experience"], row["trained_recently"])
    row["bmi"], row["bmi_label"] = planner.bmi_info(row["height_cm"], row["weight_kg"])
    row.pop("report", None)
    return row


@app.get("/api/users/{user_id}")
def read_user(user_id: int):
    return get_user(user_id)


@app.get("/api/me")
def me():
    with transaction() as conn:
        conn.execute("UPDATE users SET last_seen = ? WHERE id = ?", (now_iso(), db.uid()))
    return get_user(db.uid())


@app.put("/api/me")
def update_me(body: ProfileIn):
    fields = {key: value for key, value in body.model_dump().items() if value is not None}
    if "name" in fields:
        fields["name"] = " ".join(fields["name"].split())
        if query_one("SELECT id FROM users WHERE name = ? AND id != ?", (fields["name"], db.uid())):
            raise HTTPException(409, "This name is already taken")
    if fields:
        with transaction() as conn:
            conn.execute("UPDATE users SET " + ", ".join(key + " = ?" for key in fields) + " WHERE id = ?", (*fields.values(), db.uid()))
    return get_user(db.uid())


@app.get("/api/me/report")
def my_report():
    row = query_one("SELECT report, plan_summary FROM users WHERE id = ?", (db.uid(),))
    return row


@app.post("/api/me/regenerate")
def regenerate_program():
    if architect.is_running(db.uid()):
        raise HTTPException(409, "Your coach is already working on a program")
    has_programs = query_one("SELECT id FROM programs WHERE user_id = ? AND archived = 0 LIMIT 1", (db.uid(),))
    if has_programs:
        architect.start_rebuild(db.uid(), {"reasons": [], "details": "", "keep_schedule": False})
    else:
        with transaction() as conn:
            conn.execute("UPDATE users SET status = 'generating', status_message = 'Starting' WHERE id = ?", (db.uid(),))
        onboarding.start_async(db.uid())
    return get_user(db.uid())


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int):
    get_user(user_id)
    with transaction() as conn:
        conn.execute("DELETE FROM coach_log WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM programs WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM blocks WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if not conn.execute("SELECT 1 FROM users WHERE is_superuser = 1").fetchone():
            conn.execute("UPDATE users SET is_superuser = 1 WHERE id = (SELECT MIN(id) FROM users)")
    _known_users["time"] = 0
    return {"ok": True}


def period_bounds(period, today_value):
    if period == "week":
        start = today_value - timedelta(days=today_value.weekday())
        label = "This week"
    elif period == "month":
        start = today_value.replace(day=1)
        label = "This month"
    else:
        first = query_one("SELECT MIN(day) AS day FROM sessions WHERE status = 'done'")["day"]
        start = date.fromisoformat(first) if first else today_value
        label = "All time"
    return start, label


def user_period_stats(user, start, today_value):
    start_iso, end_iso = start.isoformat(), today_value.isoformat()
    done = query_one(
        "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND status = 'done' AND day >= ? AND day <= ?", (user["id"], start_iso, end_iso)
    )["n"]
    sets = query_one(
        """
        SELECT COUNT(*) AS n FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id JOIN sessions s ON s.id = se.session_id
        WHERE s.user_id = ? AND s.status = 'done' AND s.day >= ? AND s.day <= ? AND se.measure IN ('reps', 'sec')
        """,
        (user["id"], start_iso, end_iso),
    )["n"]
    days_elapsed = (today_value - start).days + 1
    planned = max(1, round(user["days_per_week"] * days_elapsed / 7))
    adherence = min(1.0, done / planned)

    changes = []
    records = 0
    exercises = query_all(
        """
        SELECT DISTINCT se.exercise_id FROM session_exercises se JOIN sessions s ON s.id = se.session_id
        WHERE s.user_id = ? AND s.status = 'done' AND s.day >= ? AND s.day <= ? AND se.measure = 'reps' AND se.exercise_id IS NOT NULL
        """,
        (user["id"], start_iso, end_iso),
    )
    with db.as_user(user["id"]):
        for row in exercises:
            history = [entry for entry in engine.exercise_exposures(row["exercise_id"]) if not entry["deload"]]
            before = [entry["metric"] for entry in history if entry["day"] < start_iso]
            inside = [entry for entry in history if start_iso <= entry["day"] <= end_iso]
            if not inside:
                continue
            best_inside = max(entry["metric"] for entry in inside)
            if before:
                changes.append(best_inside / max(before) - 1)
                running = max(before)
                for entry in inside:
                    if entry["metric"] > running + 1e-6:
                        records += 1
                        running = entry["metric"]
            elif len(inside) > 1:
                changes.append(best_inside / inside[0]["metric"] - 1)
    improvement = sum(changes) / len(changes) if changes else 0.0
    points = {
        "consistency": round(adherence * 40),
        "improvement": round(max(0.0, min(30.0, improvement * 100 * 3))),
        "records": min(20, records * 4),
        "volume": min(10, sets // 10),
    }
    return {
        "id": user["id"], "name": user["name"], "color": user["color"], "sex": user["sex"],
        "workouts": done, "planned": planned, "adherence": adherence, "improvement": improvement,
        "records": records, "sets": sets, "points": points, "score": sum(points.values()),
    }


@app.get("/api/leaderboard")
def leaderboard(period: str = "week", today: Optional[str] = None):
    today_value = date.fromisoformat(validate_day(today)) if today else date.today()
    start, label = period_bounds(period, today_value)
    users = query_all("SELECT id, name, color, sex, days_per_week FROM users WHERE status = 'ready' ORDER BY id")
    rows = [user_period_stats(user, start, today_value) for user in users]
    rows.sort(key=lambda row: (-row["score"], -row["adherence"], row["name"]))
    for index, row in enumerate(rows):
        row["rank"] = index + 1
    categories = {}
    for key, metric in (("consistency", "adherence"), ("improvement", "improvement"), ("records", "records"), ("volume", "sets")):
        best = max(rows, key=lambda row: row[metric], default=None)
        if best and best[metric] > 0:
            categories[key] = {"id": best["id"], "name": best["name"], "value": best[metric]}
    return {"period": period, "label": label, "start": start.isoformat(), "rows": rows, "categories": categories}


@app.get("/api/quality")
def quality_latest():
    import quality
    return quality.latest()


@app.post("/api/quality/run")
def quality_run(judge: bool = True):
    import quality
    if not ai.available():
        raise HTTPException(503, "AI is not ready: " + ai.describe(ai.status(max_age=0)))
    started = quality.start_async(judge=judge)
    return {"started": started, **quality.latest()}


@app.get("/quality")
def quality_page():
    return FileResponse(STATIC_DIR / "quality.html", headers={"Cache-Control": "no-cache"})


@app.get("/healthz")
def health():
    query_one("SELECT 1 AS ok")
    return {"ok": True}


db.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=db.MEDIA_DIR), name="media")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/m")
@app.get("/m/")
def mobile_index():
    return FileResponse(STATIC_DIR / "m" / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


import alexa
alexa.attach(app, user_period_stats)
settings_api.attach(app)
nutrition.attach(app)

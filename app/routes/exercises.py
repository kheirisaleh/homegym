import json
import secrets
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

import catalog
import db
import engine
import youtube
from db import now_iso, query_all, query_one, transaction
from deps import MAX_MEDIA_BYTES, MEASURES, MEDIA_KINDS, MEDIA_TYPES, get_exercise, remove_media_file
from schemas import ExerciseIn

router = APIRouter()


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


@router.get("/api/meta")
def meta():
    return {"muscles": catalog.MUSCLES, "muscle_labels": engine.MUSCLE_LABELS, "measures": MEASURES}


@router.get("/api/exercises")
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


@router.post("/api/exercises")
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


@router.put("/api/exercises/{exercise_id}")
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


@router.delete("/api/exercises/{exercise_id}")
def delete_exercise(exercise_id: int):
    existing = query_one("SELECT media_loop, media_muscles FROM exercises WHERE id = ?", (exercise_id,))
    with transaction() as conn:
        conn.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))
    if existing:
        for name in (existing["media_loop"], existing["media_muscles"]):
            remove_media_file(name)
    return {"ok": True}


@router.post("/api/exercises/{exercise_id}/media/{kind}")
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


@router.delete("/api/exercises/{exercise_id}/media/{kind}")
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


@router.post("/api/exercises/{exercise_id}/auto-video")
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


@router.get("/api/youtube/search")
def youtube_search(q: str, short: bool = False):
    if not q.strip():
        return []
    try:
        results = youtube.search_with_embed_check(q.strip() + (" shorts" if short else ""))
    except Exception:
        raise HTTPException(502, "YouTube search failed")
    results.sort(key=lambda item: (not item.get("embeddable"), item.get("length") is None, item.get("length") or 0))
    return results


@router.get("/api/exercises/{exercise_id}/history")
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

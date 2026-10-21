import time
from datetime import date

from fastapi import HTTPException

import db
from db import query_all, query_one

MEASURES = ("reps", "sec", "min", "none")


MEDIA_KINDS = ("loop", "muscles")


MEDIA_TYPES = {
    "image/gif": ".gif", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
}


MAX_MEDIA_BYTES = 60 * 1024 * 1024


_known_users = {"time": 0.0, "ids": set()}


def known_user(user_id):
    if user_id in _known_users["ids"] and time.time() - _known_users["time"] < 30:
        return True
    _known_users["ids"] = {row["id"] for row in query_all("SELECT id FROM users")}
    _known_users["time"] = time.time()
    return user_id in _known_users["ids"]


def known_users_changed():
    _known_users["time"] = 0.0


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


def validate_day(value):
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid date")


def get_exercise(exercise_id):
    return db.exercise_row(query_one("SELECT * FROM exercises WHERE id = ?", (exercise_id,)))


def remove_media_file(name):
    if not name:
        return
    path = (db.MEDIA_DIR / name).resolve()
    if path.parent == db.MEDIA_DIR.resolve() and path.exists():
        path.unlink()

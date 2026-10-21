import json
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import architect
import coach
import db
import reviewer

router = APIRouter()


class RebuildIn(BaseModel):
    reasons: List[str] = []
    details: str = Field(default="", max_length=1000)
    keep_schedule: bool = True
    days_per_week: Optional[int] = Field(default=None, ge=1, le=7)
    session_minutes: Optional[int] = Field(default=None, ge=20, le=120)


class FeedbackIn(BaseModel):
    rating: str = Field(pattern="^(good|weak|pain)$")
    note: str = Field(default="", max_length=300)


class CoachChoiceIn(BaseModel):
    coach: str = Field(pattern="^(max|lena)$")


def _user():
    user = db.query_one("SELECT id, name, sex, coach, status, status_message, rebuild_request FROM users WHERE id = ?", (db.uid(),))
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.get("/api/coach/persona")
def get_persona():
    user = _user()
    persona = coach.persona_for(user)
    result = coach.persona_public(persona)
    result["options"] = [coach.persona_public(item) for item in coach.PERSONAS.values()]
    return result


@router.put("/api/coach/persona")
def set_persona(body: CoachChoiceIn):
    with db.transaction() as conn:
        conn.execute("UPDATE users SET coach = ? WHERE id = ?", (body.coach, db.uid()))
    return get_persona()


@router.get("/api/coach/brief")
def get_brief(day: str, program_id: Optional[int] = None, refresh: bool = False):
    try:
        date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "Invalid day")
    if program_id is not None and not db.query_one("SELECT id FROM programs WHERE id = ? AND user_id = ?", (program_id, db.uid())):
        raise HTTPException(404, "Program not found")
    result = coach.brief(db.uid(), program_id, day, force=refresh)
    return _with_persona(result)


TRACKED = ["chest", "lats", "upper_back", "side_delts", "rear_delts", "biceps", "triceps", "quads", "hamstrings", "glutes", "abs", "obliques", "calves"]


def _week_progress(user_id, day):
    start = date.fromisoformat(day) - timedelta(days=date.fromisoformat(day).weekday())
    exercises = {row["id"]: row for row in db.query_all("SELECT id, primary_muscle, secondary_muscles, measure FROM exercises")}
    planned = {}
    for row in db.query_all(
        "SELECT pe.exercise_id, pe.sets FROM program_exercises pe JOIN programs p ON p.id = pe.program_id WHERE p.user_id = ? AND p.archived = 0 AND p.weekday IS NOT NULL",
        (user_id,),
    ):
        exercise = exercises.get(row["exercise_id"])
        if not exercise or exercise["measure"] not in ("reps", "sec"):
            continue
        planned[exercise["primary_muscle"]] = planned.get(exercise["primary_muscle"], 0) + row["sets"]
        for muscle in json.loads(exercise["secondary_muscles"] or "[]"):
            planned[muscle] = planned.get(muscle, 0) + row["sets"] * 0.5
    done = {}
    for row in db.query_all(
        """
        SELECT se.exercise_id, COUNT(ss.id) AS n FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id
        JOIN sessions s ON s.id = se.session_id
        WHERE s.user_id = ? AND s.day >= ? AND s.day <= ? AND ss.value IS NOT NULL GROUP BY se.exercise_id
        """,
        (user_id, start.isoformat(), day),
    ):
        exercise = exercises.get(row["exercise_id"])
        if not exercise or exercise["measure"] not in ("reps", "sec"):
            continue
        done[exercise["primary_muscle"]] = done.get(exercise["primary_muscle"], 0) + row["n"]
        for muscle in json.loads(exercise["secondary_muscles"] or "[]"):
            done[muscle] = done.get(muscle, 0) + row["n"] * 0.5
    priority = json.loads((db.query_one("SELECT priority_muscles FROM users WHERE id = ?", (user_id,)) or {}).get("priority_muscles") or "[]")
    rows = []
    for muscle in TRACKED:
        target = round(planned.get(muscle, 0), 1)
        value = round(done.get(muscle, 0), 1)
        if target <= 0 and value <= 0:
            continue
        rows.append({"muscle": muscle, "done": value, "planned": target, "priority": muscle in priority})
    rows.sort(key=lambda row: (not row["priority"], -row["planned"]))
    days_left = 6 - date.fromisoformat(day).weekday()
    return {"start": start.isoformat(), "days_left": days_left, "rows": rows}


@router.get("/api/coach/today")
def coach_today(day: str):
    try:
        date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "Invalid day")
    user_id = db.uid()
    program_id, program_day = coach.next_program(user_id, day)
    result = {"persona": coach.persona_public(coach.persona_for(_user())), "week": _week_progress(user_id, day), "program": None, "brief": None, "program_day": program_day}
    if program_id:
        program = db.query_one("SELECT id, name, weekday FROM programs WHERE id = ?", (program_id,))
        result["program"] = program
        if program_day == day:
            message = coach.brief(user_id, program_id, day)
            result["brief"] = {key: message[key] for key in ("title", "message", "points", "source")}
    return result


@router.get("/api/session-exercises/{session_exercise_id}/tip")
def rest_tip(session_exercise_id: int):
    tip = coach.rest_tip(db.uid(), session_exercise_id)
    if not tip:
        raise HTTPException(404, "Exercise not found")
    return tip


@router.get("/api/sessions/{session_id}/outro")
def get_outro(session_id: int, refresh: bool = False):
    session = db.query_one("SELECT id, status FROM sessions WHERE id = ? AND user_id = ?", (session_id, db.uid()))
    if not session:
        raise HTTPException(404, "Workout not found")
    if session["status"] != "done":
        raise HTTPException(409, "The workout is not finished yet")
    result = coach.outro(db.uid(), session_id, wait=0 if refresh else 6)
    return _with_persona(result)


def _with_persona(result):
    user = _user()
    persona = coach.persona_for(user)
    result = dict(result or {})
    result["persona"] = coach.persona_public(persona)
    return result


@router.post("/api/session-exercises/{session_exercise_id}/feedback")
def save_feedback(session_exercise_id: int, body: FeedbackIn):
    entry = db.query_one(
        "SELECT se.id, se.session_id, se.exercise_id FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE se.id = ? AND s.user_id = ?",
        (session_exercise_id, db.uid()),
    )
    if not entry:
        raise HTTPException(404, "Exercise not found")
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO exercise_feedback (user_id, session_id, session_exercise_id, exercise_id, rating, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_exercise_id) DO UPDATE SET rating = excluded.rating, note = excluded.note, created_at = excluded.created_at
            """,
            (db.uid(), entry["session_id"], session_exercise_id, entry["exercise_id"], body.rating, body.note.strip(), db.now_iso()),
        )
    return {"session_exercise_id": session_exercise_id, "rating": body.rating, "note": body.note.strip()}


@router.delete("/api/session-exercises/{session_exercise_id}/feedback")
def delete_feedback(session_exercise_id: int):
    with db.transaction() as conn:
        conn.execute("DELETE FROM exercise_feedback WHERE session_exercise_id = ? AND user_id = ?", (session_exercise_id, db.uid()))
    return {"ok": True}


@router.get("/api/sessions/{session_id}/feedback")
def list_feedback(session_id: int):
    rows = db.query_all("SELECT session_exercise_id, rating, note FROM exercise_feedback WHERE session_id = ? AND user_id = ?", (session_id, db.uid()))
    return {str(row["session_exercise_id"]): {"rating": row["rating"], "note": row["note"]} for row in rows}


@router.get("/api/me/rebuild")
def rebuild_state():
    user = _user()
    last = db.query_one("SELECT created_at, score, attempts, problems FROM ai_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1", (db.uid(),))
    previous = json.loads(db.get_user_setting("previous_programs", "[]", user_id=db.uid()) or "[]")
    return {
        "status": user["status"],
        "status_message": user["status_message"],
        "running": architect.is_running(db.uid()) or user["status"] == "generating",
        "can_restore": bool(previous),
        "last_run": last,
        "reasons": [{"key": key, "label": label} for key, label in architect.REBUILD_REASONS.items()],
    }


@router.post("/api/me/rebuild")
def start_rebuild(body: RebuildIn):
    user = _user()
    if user["status"] == "generating" or architect.is_running(db.uid()):
        raise HTTPException(409, "Your coach is already working on a program")
    if db.query_one("SELECT id FROM sessions WHERE user_id = ? AND status = 'active'", (db.uid(),)):
        raise HTTPException(409, "Finish or discard the workout in progress first")
    request = {
        "reasons": [reason for reason in body.reasons if reason in architect.REBUILD_REASONS],
        "details": body.details.strip(),
        "keep_schedule": body.keep_schedule,
    }
    if body.days_per_week:
        request["days_per_week"] = body.days_per_week
        request["keep_schedule"] = False
    if body.session_minutes:
        request["session_minutes"] = body.session_minutes
    architect.start_rebuild(db.uid(), request)
    return rebuild_state()


@router.post("/api/me/rebuild/restore")
def restore_program():
    if architect.is_running(db.uid()):
        raise HTTPException(409, "Your coach is still working")
    if not architect.restore_previous(db.uid()):
        raise HTTPException(404, "There is no previous program to restore")
    return rebuild_state()


@router.post("/api/coach/review/run")
def run_review():
    return reviewer.review_user(db.uid(), force=True)

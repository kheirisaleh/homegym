import json
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException

import coach
import cycle
import db
import engine
from db import now_iso, query_all, query_one, transaction
from deps import get_exercise, own_session, own_session_exercise, own_set, validate_day
from routes.programs import load_program
from schemas import FinishIn, PlannedIn, SessionExerciseIn, SessionIn, SessionStateIn, SetIn, SetUpdate

router = APIRouter()


SESSION_LIST_SQL = """
    SELECT s.*,
      (SELECT COUNT(*) FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id WHERE se.session_id = s.id) AS sets_done,
      (SELECT COALESCE(SUM(se.planned_sets), 0) FROM session_exercises se WHERE se.session_id = s.id) AS sets_planned,
      (SELECT COALESCE(SUM(ss.value * ss.weight), 0) FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id
         WHERE se.session_id = s.id AND se.measure = 'reps' AND ss.weight IS NOT NULL AND ss.value IS NOT NULL) AS volume
    FROM sessions s
"""


@router.get("/api/sessions")
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


@router.get("/api/sessions/active")
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


@router.post("/api/sessions")
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


@router.get("/api/sessions/{session_id}")
def get_session(session_id: int):
    session = load_session(session_id)
    if not session:
        raise HTTPException(404, "Workout not found")
    return session


@router.post("/api/sessions/{session_id}/exercises")
def add_session_exercise(session_id: int, body: SessionExerciseIn):
    own_session(session_id)
    exercise = get_exercise(body.exercise_id)
    if not exercise:
        raise HTTPException(404, "Exercise not found")
    with transaction() as conn:
        row = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM session_exercises WHERE session_id = ?", (session_id,)).fetchone()
        insert_session_exercise(conn, session_id, row["next"], exercise, body.sets, body.target.strip(), body.rest_seconds, False)
    return load_session(session_id)


@router.delete("/api/session-exercises/{session_exercise_id}")
def remove_session_exercise(session_exercise_id: int):
    own_session_exercise(session_exercise_id)
    with transaction() as conn:
        conn.execute("DELETE FROM session_exercises WHERE id = ?", (session_exercise_id,))
    return {"ok": True}


@router.put("/api/session-exercises/{session_exercise_id}/planned")
def change_planned_sets(session_exercise_id: int, body: PlannedIn):
    own_session_exercise(session_exercise_id)
    with transaction() as conn:
        conn.execute("UPDATE session_exercises SET planned_sets = ? WHERE id = ?", (body.sets, session_exercise_id))
    return {"ok": True}


@router.post("/api/sets")
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


@router.put("/api/sets/{set_id}")
def update_set(set_id: int, body: SetUpdate):
    own_set(set_id)
    with transaction() as conn:
        conn.execute("UPDATE session_sets SET value = ?, weight = ?, effort = ? WHERE id = ?", (body.value, body.weight, body.effort, set_id))
    return query_one("SELECT * FROM session_sets WHERE id = ?", (set_id,))


@router.delete("/api/sets/{set_id}")
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


@router.put("/api/sessions/{session_id}/state")
def save_state(session_id: int, body: SessionStateIn):
    own_session(session_id)
    with transaction() as conn:
        conn.execute("UPDATE sessions SET current_index = ? WHERE id = ?", (body.current_index, session_id))
    return {"ok": True}


@router.post("/api/sessions/{session_id}/finish")
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


@router.post("/api/sessions/{session_id}/reopen")
def reopen_session(session_id: int):
    own_session(session_id)
    if query_one("SELECT id FROM sessions WHERE status = 'active' AND id != ? AND user_id = ? LIMIT 1", (session_id, db.uid())):
        raise HTTPException(409, "Another workout is still in progress")
    with transaction() as conn:
        conn.execute("UPDATE sessions SET status = 'active', finished_at = NULL WHERE id = ?", (session_id,))
    return load_session(session_id)


@router.delete("/api/sessions/{session_id}")
def delete_session(session_id: int):
    own_session(session_id)
    with transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return {"ok": True}

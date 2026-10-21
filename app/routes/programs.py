import json
from datetime import date

from fastapi import APIRouter, HTTPException

import db
import engine
from db import now_iso, query_all, query_one, transaction
from deps import own_program, validate_day
from schemas import ProgramIn, ProgramItemIn

router = APIRouter()


def load_program(program_id):
    program = query_one("SELECT * FROM programs WHERE id = ? AND user_id = ?", (program_id, db.uid()))
    if not program:
        return None
    program["items"] = query_all(
        """
        SELECT pe.id, pe.exercise_id, pe.position, pe.sets, pe.target, pe.rest_seconds, pe.rep_min, pe.rep_max, pe.target_weight, pe.added_block, pe.cue,
               e.name, e.measure, e.track_weight, e.video_id, e.primary_muscle, e.media_loop, e.equipment, e.pattern
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


@router.get("/api/programs")
def list_programs():
    ids = query_all("SELECT id FROM programs WHERE archived = 0 AND user_id = ? ORDER BY COALESCE(weekday, 99), name", (db.uid(),))
    return [load_program(row["id"]) for row in ids]


@router.get("/api/programs/{program_id}")
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


@router.post("/api/programs")
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


@router.put("/api/programs/{program_id}")
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


@router.post("/api/programs/{program_id}/duplicate")
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


@router.delete("/api/programs/{program_id}")
def delete_program(program_id: int):
    own_program(program_id)
    with transaction() as conn:
        used = conn.execute("SELECT 1 FROM sessions WHERE program_id = ? LIMIT 1", (program_id,)).fetchone()
        if used:
            conn.execute("UPDATE programs SET archived = 1 WHERE id = ?", (program_id,))
        else:
            conn.execute("DELETE FROM programs WHERE id = ?", (program_id,))
    return {"ok": True}


@router.post("/api/programs/{program_id}/restore/{version_id}")
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


@router.get("/api/suggestions")
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

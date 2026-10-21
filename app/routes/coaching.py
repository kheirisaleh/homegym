import json

from fastapi import APIRouter, HTTPException

import ai
import catalog
import db
import engine
from db import query_all, query_one, transaction
from schemas import RedesignIn, SettingsIn

router = APIRouter()


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


@router.get("/api/coach")
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


@router.get("/api/ai/status")
def ai_status(fresh: bool = False):
    state = ai.status(max_age=0 if fresh else 15)
    state["message"] = ai.describe(state)
    return state


@router.put("/api/coach/settings")
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


@router.post("/api/coach/progress")
def coach_progress():
    return engine.run_pending_progression()


@router.post("/api/coach/review")
def coach_review():
    try:
        return {"summary": engine.force_review()}
    except engine.AIUnavailable as error:
        raise HTTPException(503, "The AI coach is not ready: " + str(error))


@router.post("/api/coach/deload")
def coach_deload():
    started = engine.start_deload("Triggered manually.", manual=True)
    return {"started": started}


@router.post("/api/coach/fatigue")
def coach_fatigue():
    return engine.register_fatigue()


@router.post("/api/coach/redesign/{program_id}")
def coach_redesign(program_id: int, body: RedesignIn):
    try:
        return engine.redesign_program(program_id, body.instruction)
    except engine.AIUnavailable as error:
        raise HTTPException(503, "The AI coach is not ready: " + str(error))
    except ValueError as error:
        raise HTTPException(422, "Redesign failed: " + str(error))
    except Exception as error:
        raise HTTPException(502, "AI not reachable or answer invalid: " + str(error)[:200])


@router.post("/api/coach/log/{log_id}/undo")
def coach_undo(log_id: int):
    if not engine.undo(log_id):
        raise HTTPException(400, "This change cannot be undone")
    return {"ok": True}

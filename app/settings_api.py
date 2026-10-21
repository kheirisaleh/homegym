from typing import Dict, List, Optional

from fastapi import Header, HTTPException
from pydantic import BaseModel

import ai
import config
import db


class PinIn(BaseModel):
    pin: str
    new_pin: Optional[str] = None


class SettingsUpdateIn(BaseModel):
    values: Dict[str, object] = {}
    reset: List[str] = []


def _is_superuser():
    user_id = db.current_user_id()
    if not user_id:
        return False
    row = db.query_one("SELECT is_superuser FROM users WHERE id = ?", (user_id,))
    return bool(row and row["is_superuser"])


def _require_superuser():
    if not _is_superuser():
        raise HTTPException(403, "Only the main account can open the settings")


def _require(token):
    _require_superuser()
    if not config.valid_session(token):
        raise HTTPException(401, "Enter the admin PIN first")


def _reset_ai_cache(changed):
    if any(key.startswith(("ai_", "gemini_", "ollama_")) for key in changed):
        with ai._status_lock:
            ai._status_cache["value"] = None
            ai._status_cache["time"] = 0.0


def attach(app):
    config.on_change(_reset_ai_cache)

    @app.get("/api/admin/state")
    def admin_state(x_admin_token: Optional[str] = Header(None)):
        allowed = _is_superuser()
        return {"pin_set": config.pin_is_set(), "allowed": allowed, "unlocked": allowed and config.valid_session(x_admin_token)}

    @app.post("/api/admin/unlock")
    def admin_unlock(body: PinIn):
        _require_superuser()
        try:
            if not config.pin_is_set():
                return {"token": config.set_pin(body.pin)}
            return {"token": config.login(body.pin)}
        except ValueError as error:
            raise HTTPException(400, str(error))
        except PermissionError as error:
            raise HTTPException(403, str(error))

    @app.post("/api/admin/pin")
    def admin_change_pin(body: PinIn, x_admin_token: Optional[str] = Header(None)):
        _require(x_admin_token)
        try:
            config.login(body.pin)
            return {"token": config.set_pin(body.new_pin or "")}
        except ValueError as error:
            raise HTTPException(400, str(error))
        except PermissionError as error:
            raise HTTPException(403, str(error))

    @app.post("/api/admin/lock")
    def admin_lock(x_admin_token: Optional[str] = Header(None)):
        config.logout(x_admin_token)
        return {"ok": True}

    @app.get("/api/admin/settings")
    def admin_settings(x_admin_token: Optional[str] = Header(None)):
        _require(x_admin_token)
        return config.public_view()

    @app.put("/api/admin/settings")
    def admin_update(body: SettingsUpdateIn, x_admin_token: Optional[str] = Header(None)):
        _require(x_admin_token)
        try:
            return config.update(body.values, body.reset)
        except ValueError as error:
            raise HTTPException(400, str(error))

    @app.post("/api/admin/pantry/sync")
    def admin_pantry_sync(x_admin_token: Optional[str] = Header(None)):
        _require(x_admin_token)
        import nutrition
        try:
            result = nutrition.sync()
        except nutrition.PantryError as error:
            raise HTTPException(400, str(error))
        return {**result, "message": "Synced " + str(result["days"]) + " person days from the pantry"}

    @app.post("/api/admin/settings/test")
    def admin_test(x_admin_token: Optional[str] = Header(None)):
        _require(x_admin_token)
        state = ai.status(max_age=0)
        state["message"] = ai.describe(state)
        return state

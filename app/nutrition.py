import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Optional

from fastapi import Header, HTTPException, Request

import config
import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS nutrition_days (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    kcal REAL,
    protein REAL,
    fat REAL,
    carbs REAL,
    fiber REAL,
    complete INTEGER NOT NULL DEFAULT 1,
    entries TEXT NOT NULL DEFAULT '[]',
    synced_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
);
"""

KEYS = ("kcal", "protein", "fat", "carbs", "fiber")
SYNC_DAYS = 14
SYNC_INTERVAL = 6 * 3600
_state = {"last_sync": None, "last_error": None, "last_count": 0}
_lock = threading.Lock()


class PantryError(Exception):
    pass


def init_schema():
    with db.transaction() as conn:
        conn.executescript(SCHEMA)


def enabled():
    return config.get_bool("pantry_enabled") and bool(config.get("pantry_url").strip()) and bool(config.get("pantry_token").strip())


def _fetch(path, params):
    base = config.get("pantry_url").strip().rstrip("/")
    url = base + path + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + config.get("pantry_token").strip(), "User-Agent": "HomeGym/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise PantryError("The pantry rejected the API key")
        raise PantryError("Pantry answered " + str(error.code))
    except Exception as error:
        raise PantryError("Pantry not reachable: " + str(error)[:120])


def _user_map():
    rows = db.query_all("SELECT id, name FROM users")
    return {row["name"].strip().lower(): row["id"] for row in rows}


def sync(start=None, end=None):
    if not enabled():
        raise PantryError("Pantry link is off or not configured")
    end_day = date.fromisoformat(end) if end else date.today()
    start_day = date.fromisoformat(start) if start else end_day - timedelta(days=SYNC_DAYS - 1)
    with _lock:
        try:
            data = _fetch("/api/export/nutrition", {"start": start_day.isoformat(), "end": end_day.isoformat()})
        except PantryError as error:
            _state["last_error"] = str(error)
            raise
        users = _user_map()
        stored = 0
        with db.transaction() as conn:
            for report in data.get("days", []):
                user_id = users.get(str((report.get("user") or {}).get("name") or "").strip().lower())
                if not user_id or not report.get("date"):
                    continue
                totals = report.get("totals") or {}
                entries = [
                    {key: entry.get(key) for key in ("type", "name", "name_fa", "qty", "unit", "kcal", "protein") if entry.get(key) is not None}
                    for entry in report.get("entries") or []
                ]
                conn.execute(
                    "INSERT INTO nutrition_days (user_id, day, kcal, protein, fat, carbs, fiber, complete, entries, synced_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET kcal = excluded.kcal, protein = excluded.protein, "
                    "fat = excluded.fat, carbs = excluded.carbs, fiber = excluded.fiber, complete = excluded.complete, entries = excluded.entries, "
                    "synced_at = excluded.synced_at",
                    (user_id, report["date"], *[totals.get(key) for key in KEYS], 1 if report.get("complete", True) else 0,
                     json.dumps(entries, ensure_ascii=False), db.now_iso()),
                )
                stored += 1
        _state.update(last_sync=db.now_iso(), last_error=None, last_count=stored)
        return {"days": stored, "start": start_day.isoformat(), "end": end_day.isoformat()}


def status():
    return {"enabled": enabled(), **_state}


def week(user_id, days=7, end=None):
    end_day = date.fromisoformat(end) if end else date.today()
    start_day = end_day - timedelta(days=days - 1)
    rows = db.query_all(
        "SELECT * FROM nutrition_days WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day",
        (user_id, start_day.isoformat(), end_day.isoformat()),
    )
    for row in rows:
        row["entries"] = json.loads(row["entries"] or "[]")
        row["complete"] = bool(row["complete"])
    logged = [row for row in rows if row["entries"]]
    average = {}
    for key in KEYS:
        values = [row[key] for row in logged if row[key] is not None]
        average[key] = round(sum(values) / len(values), 1) if values else None
    return {"start": start_day.isoformat(), "end": end_day.isoformat(), "days": rows, "logged_days": len(logged), "average": average}


def _number(value, unit):
    return "unknown" if value is None else str(int(round(value))) + unit


def prompt_lines(user_id, short=False):
    if not config.get_bool("pantry_enabled"):
        return []
    summary = week(user_id, end=(date.today() - timedelta(days=1)).isoformat())
    if not summary["logged_days"]:
        return []
    user = db.query_one("SELECT weight_kg FROM users WHERE id = ?", (user_id,)) or {}
    average = summary["average"]
    lines = [
        "",
        "Nutrition last 7 days from the home pantry (only meals cooked at home and logged snacks, eating out is missing): " +
        str(summary["logged_days"]) + " of 7 days logged.",
        "Daily average on logged days: " + _number(average["kcal"], " kcal") + ", protein " + _number(average["protein"], " g") +
        ", carbs " + _number(average["carbs"], " g") + ", fat " + _number(average["fat"], " g") + ".",
    ]
    if summary["logged_days"] < 4:
        lines.append("Too few days logged to judge totals. Mention food only if a listed meal is clearly relevant to today.")
    elif user.get("weight_kg") and average["protein"]:
        lines.append("Protein per kg body weight: {:.1f} g.".format(average["protein"] / user["weight_kg"]))
    if short:
        return lines
    lines.append("Meals per day:")
    for row in summary["days"]:
        if not row["entries"]:
            continue
        names = [entry["name"] for entry in row["entries"] if entry.get("name")]
        lines.append("  " + row["day"] + ": " + ", ".join(names[:8]) + " (" + _number(row["kcal"], " kcal") + ", protein " + _number(row["protein"], " g") +
                     ("" if row["complete"] else ", some values missing") + ")")
    lines.append("Use this only as context. If protein looks low for the goal, say so in one short sentence. Never invent foods that are not listed.")
    return lines


def _verify(raw, stamp, signature):
    secret = config.get("pantry_webhook_secret").strip()
    if not secret:
        return True
    try:
        if not stamp or not signature or abs(time.time() - int(stamp)) > 600:
            return False
    except ValueError:
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), (stamp + ".").encode("utf-8") + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def worker():
    time.sleep(20)
    while True:
        if enabled():
            try:
                sync()
            except Exception as error:
                print("pantry sync failed:", error, flush=True)
        time.sleep(SYNC_INTERVAL)


def attach(app):
    init_schema()
    threading.Thread(target=worker, daemon=True).start()

    @app.post("/api/integrations/pantry")
    async def pantry_webhook(request: Request, x_pantry_timestamp: Optional[str] = Header(None), x_pantry_signature: Optional[str] = Header(None)):
        raw = await request.body()
        if not _verify(raw, x_pantry_timestamp, x_pantry_signature):
            raise HTTPException(401, "Bad signature")
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(400, "Invalid JSON")
        if body.get("type") not in ("nutrition.daily", "meal.cooked", "meal.uncooked", "test", "ping"):
            return {"ok": True, "ignored": body.get("type")}
        if not enabled():
            return {"ok": True, "ignored": "pantry link is off"}
        day = (body.get("data") or {}).get("date")
        threading.Thread(target=lambda: _safe_sync(day), daemon=True).start()
        return {"ok": True}

    @app.get("/api/nutrition/week")
    def nutrition_week(days: int = 7):
        return {**week(db.uid(), days=max(1, min(days, 28))), "status": status()}


def _safe_sync(day=None):
    try:
        if day:
            sync(start=day, end=day)
        else:
            sync()
    except Exception as error:
        print("pantry webhook sync failed:", error, flush=True)

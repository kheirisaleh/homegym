import json
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter

import db
import engine
from db import query_all, query_one, transaction
from deps import validate_day
from routes.sessions import SESSION_LIST_SQL
from schemas import BodyIn

router = APIRouter()


def week_key(day_value):
    return (day_value - timedelta(days=day_value.weekday())).isoformat()


@router.get("/api/dashboard")
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


@router.get("/api/stats")
def stats(today: Optional[str] = None):
    data = dashboard(today)
    return data["stats"]


@router.get("/api/body")
def list_body():
    return {"entries": query_all("SELECT day, weight_kg, waist_cm FROM body_metrics WHERE user_id = ? ORDER BY day", (db.uid(),)), "trend": engine.bodyweight_trend()}


@router.put("/api/body")
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

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter

import db
import engine
from db import query_all, query_one
from deps import validate_day

router = APIRouter()


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


@router.get("/api/leaderboard")
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

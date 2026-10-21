import json
from datetime import date

from fastapi import APIRouter, HTTPException

import architect
import catalog
import db
import onboarding
import planner
from db import now_iso, query_all, query_one, transaction
from deps import known_users_changed
from schemas import OnboardingIn, ProfileIn

router = APIRouter()


USER_PUBLIC = "id, name, sex, color, status, status_message, created_at, last_seen, goal, days_per_week, coach, is_superuser"


def user_public(row):
    stats = query_one(
        "SELECT COUNT(*) AS workouts, MAX(day) AS last_day FROM sessions WHERE user_id = ? AND status = 'done'", (row["id"],)
    )
    row.update(stats)
    return row


@router.get("/api/users")
def list_users():
    rows = query_all("SELECT " + USER_PUBLIC + " FROM users ORDER BY COALESCE(last_seen, created_at) DESC")
    return [user_public(row) for row in rows]


@router.post("/api/users")
def create_user(body: OnboardingIn):
    name = " ".join(body.name.split())
    if query_one("SELECT id FROM users WHERE name = ?", (name,)):
        raise HTTPException(409, "This name is already taken")
    count = query_one("SELECT COUNT(*) AS n FROM users")["n"]
    first_admin = query_one("SELECT id FROM users WHERE is_superuser = 1") is None
    priority = [muscle for muscle in body.priority_muscles if muscle in catalog.MUSCLES and muscle not in catalog.NON_HYPERTROPHY_MUSCLES]
    with transaction() as conn:
        user_id = conn.execute(
            """
            INSERT INTO users (name, sex, age, height_cm, weight_kg, experience, trained_recently, goal, days_per_week, session_minutes,
              priority_muscles, limitations, color, status, status_message, created_at, last_seen, coach)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', 'Starting', ?, ?, ?)
            """,
            (
                name, body.sex, body.age, body.height_cm, body.weight_kg, body.experience, 1 if body.trained_recently else 0, body.goal,
                body.days_per_week, body.session_minutes, json.dumps(priority), body.limitations.strip(), db.USER_COLORS[count % len(db.USER_COLORS)],
                now_iso(), now_iso(), body.coach or ("lena" if body.sex == "female" else "max"),
            ),
        ).lastrowid
        if first_admin:
            conn.execute("UPDATE users SET is_superuser = 1 WHERE id = ?", (user_id,))
        if body.weight_kg:
            conn.execute("INSERT INTO body_metrics (user_id, day, weight_kg) VALUES (?, ?, ?)", (user_id, date.today().isoformat(), body.weight_kg))
    known_users_changed()
    onboarding.start_async(user_id)
    return get_user(user_id)


def get_user(user_id):
    row = query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(404, "User not found")
    row["priority_muscles"] = json.loads(row["priority_muscles"] or "[]")
    row["trained_recently"] = bool(row["trained_recently"])
    row["is_superuser"] = bool(row.get("is_superuser"))
    row["level"] = planner.derive_level(row["experience"], row["trained_recently"])
    row["bmi"], row["bmi_label"] = planner.bmi_info(row["height_cm"], row["weight_kg"])
    row.pop("report", None)
    return row


@router.get("/api/users/{user_id}")
def read_user(user_id: int):
    return get_user(user_id)


@router.get("/api/me")
def me():
    with transaction() as conn:
        conn.execute("UPDATE users SET last_seen = ? WHERE id = ?", (now_iso(), db.uid()))
    return get_user(db.uid())


@router.put("/api/me")
def update_me(body: ProfileIn):
    fields = {key: value for key, value in body.model_dump().items() if value is not None}
    if "name" in fields:
        fields["name"] = " ".join(fields["name"].split())
        if query_one("SELECT id FROM users WHERE name = ? AND id != ?", (fields["name"], db.uid())):
            raise HTTPException(409, "This name is already taken")
    if fields:
        with transaction() as conn:
            conn.execute("UPDATE users SET " + ", ".join(key + " = ?" for key in fields) + " WHERE id = ?", (*fields.values(), db.uid()))
    return get_user(db.uid())


@router.get("/api/me/report")
def my_report():
    row = query_one("SELECT report, plan_summary FROM users WHERE id = ?", (db.uid(),))
    return row


@router.post("/api/me/regenerate")
def regenerate_program():
    if architect.is_running(db.uid()):
        raise HTTPException(409, "Your coach is already working on a program")
    has_programs = query_one("SELECT id FROM programs WHERE user_id = ? AND archived = 0 LIMIT 1", (db.uid(),))
    if has_programs:
        architect.start_rebuild(db.uid(), {"reasons": [], "details": "", "keep_schedule": False})
    else:
        with transaction() as conn:
            conn.execute("UPDATE users SET status = 'generating', status_message = 'Starting' WHERE id = ?", (db.uid(),))
        onboarding.start_async(db.uid())
    return get_user(db.uid())


@router.delete("/api/users/{user_id}")
def delete_user(user_id: int):
    get_user(user_id)
    with transaction() as conn:
        conn.execute("DELETE FROM coach_log WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM programs WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM blocks WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if not conn.execute("SELECT 1 FROM users WHERE is_superuser = 1").fetchone():
            conn.execute("UPDATE users SET is_superuser = 1 WHERE id = (SELECT MIN(id) FROM users)")
    known_users_changed()
    return {"ok": True}

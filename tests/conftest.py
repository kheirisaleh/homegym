import os
import shutil
import tempfile
from pathlib import Path

DATA_ROOT = Path(tempfile.mkdtemp(prefix="homegym-tests-"))
os.environ["DATA_DIR"] = str(DATA_ROOT)
os.environ["BACKGROUND_WORKERS"] = "0"
os.environ["AUTO_VIDEO"] = "0"
os.environ["AI_PROVIDER"] = "gemini"
os.environ["GEMINI_API_KEY"] = ""
os.environ["WEB_DIR"] = str(DATA_ROOT / "web")

import pytest
from fastapi.testclient import TestClient

import ai
import architect
import coach
import config
import cycle
import db
import deps
import engine
import main
import nutrition
import onboarding


def reset_database():
    if db._connection is not None:
        db._connection.close()
        db._connection = None
    for entry in DATA_ROOT.iterdir():
        if entry.name == "web":
            continue
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    deps._known_users["time"] = 0.0
    deps._known_users["ids"] = set()
    ai._status_cache["value"] = None
    ai._status_cache["time"] = 0.0
    config._sessions.clear()
    config._failures.update(count=0, until=0.0)
    cycle._attempts.clear()
    coach._backoff["until"] = 0.0
    db.init_db()
    cycle.init_schema()
    nutrition.init_schema()


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    reset_database()
    monkeypatch.setattr(onboarding, "start_async", lambda user_id: None)
    monkeypatch.setattr(architect, "run_rebuild", lambda user_id, request: None)
    monkeypatch.setattr(coach, "_generate_brief_ai", lambda *args, **kwargs: None)
    monkeypatch.setattr(coach, "start_outro", lambda user_id, session_id: None)
    monkeypatch.setattr(engine, "session_note", lambda session_id: None)
    yield
    if db._connection is not None:
        db._connection.close()
        db._connection = None


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


class FakeAI:
    def __init__(self):
        self.calls = []

    def status(self, max_age=15):
        return {"provider": "fake", "url": "", "model": "fake", "reachable": True, "model_installed": True, "models": ["fake"], "pulling": False,
                "key_set": True, "error": "", "ready": True}

    def choose_swap(self, current, candidates, context):
        self.calls.append(("swap", current["name"]))
        return {"exercise_id": candidates[0]["id"], "reason": "Closest match."}

    def block_note(self, context):
        self.calls.append(("block_note", context))
        return "Solid block."

    def redesign_program(self, prompt):
        self.calls.append(("redesign", prompt))
        return {"items": [], "rationale": ""}


@pytest.fixture
def fake_ai(monkeypatch):
    fake = FakeAI()
    monkeypatch.setattr(ai, "status", fake.status)
    monkeypatch.setattr(ai, "choose_swap", fake.choose_swap)
    monkeypatch.setattr(ai, "block_note", fake.block_note)
    monkeypatch.setattr(ai, "redesign_program", fake.redesign_program)
    return fake


ONBOARDING = {
    "sex": "male", "age": 30, "height_cm": 180, "weight_kg": 80, "experience": "6_to_24_months", "trained_recently": True,
    "goal": "muscle", "days_per_week": 3, "session_minutes": 60, "priority_muscles": ["chest"], "limitations": "",
}


def create_user(client, name="Alex", **overrides):
    response = client.post("/api/users", json={**ONBOARDING, "name": name, **overrides})
    assert response.status_code == 200, response.text
    user = response.json()
    with db.transaction() as conn:
        conn.execute("UPDATE users SET status = 'ready', status_message = '' WHERE id = ?", (user["id"],))
    return user["id"]


def as_user(user_id):
    return {"X-User-Id": str(user_id)}


def exercises_by_name(client, user_id):
    return {item["name"]: item for item in client.get("/api/exercises", headers=as_user(user_id)).json()}


def weighted_exercise(client, user_id, name="Barbell Bench Press"):
    return exercises_by_name(client, user_id)[name]


def create_program(client, user_id, items, name="Push", weekday=None):
    response = client.post("/api/programs", json={"name": name, "weekday": weekday, "description": "", "items": items}, headers=as_user(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def start_session(client, user_id, program_id, day):
    response = client.post("/api/sessions", json={"day": day, "program_id": program_id}, headers=as_user(user_id))
    assert response.status_code == 200, response.text
    return response.json()


def log_sets(client, user_id, entry, values, weight=None):
    for value in values:
        response = client.post("/api/sets", json={"session_exercise_id": entry["id"], "value": value, "weight": weight}, headers=as_user(user_id))
        assert response.status_code == 200, response.text


def finish(client, user_id, session_id):
    response = client.post("/api/sessions/" + str(session_id) + "/finish", json={"notes": ""}, headers=as_user(user_id))
    assert response.status_code == 200, response.text
    return response.json()

import hashlib
import hmac
import json
import time
from datetime import date

import pytest

import config
import db
from conftest import as_user, create_program, create_user, exercises_by_name

CHECKIN = {"energy": 2, "cramps": 2, "back_pain": 0, "headache": 0, "bloating": 0, "flow": 2}


@pytest.fixture
def lena(client):
    return create_user(client, "Lena", sex="female")


def unlock(client, user_id, pin="2468"):
    response = client.post("/api/cycle/pin", json={"pin": pin}, headers=as_user(user_id))
    assert response.status_code == 200, response.text
    return {**as_user(user_id), "X-Health-Token": response.json()["token"]}


def test_cycle_features_are_only_for_female_profiles(client):
    user_id = create_user(client)
    assert client.get("/api/cycle/state", headers=as_user(user_id)).json() == {"eligible": False}
    assert client.post("/api/cycle/start", json={"day": "2026-01-01"}, headers=as_user(user_id)).status_code == 403


def test_period_mode_adjusts_the_workout(client, lena):
    today = date.today().isoformat()
    exercises = exercises_by_name(client, lena)
    program = create_program(client, lena, [{"exercise_id": exercises["Barbell Bench Press"]["id"], "sets": 4, "rep_min": 8, "rep_max": 12, "rest_seconds": 90,
                                             "target_weight": 40}])
    state = client.post("/api/cycle/start", json={"day": today, "checkin": {**CHECKIN, "day": today}}, headers=as_user(lena)).json()
    assert state["active"] is True
    assert state["period_day"] == 1
    assert state["level"] == "moderate"
    plan = client.post("/api/cycle/plan/" + str(program["id"]), params={"day": today}, headers=as_user(lena)).json()
    assert plan["level"] == "moderate"
    item = plan["items"][0]
    assert item["sets"] == 2
    assert item["target_weight"] == 35
    session = client.post("/api/sessions", json={"day": today, "program_id": program["id"]}, headers=as_user(lena)).json()
    assert session["cycle_adjusted"] == 1
    assert session["program_name"] == "Push (light)"
    assert session["exercises"][0]["planned_sets"] == 2
    assert session["exercises"][0]["target"] == "8–12"
    stopped = client.post("/api/cycle/stop", json={"day": today}, headers=as_user(lena)).json()
    assert stopped["active"] is False


def test_rest_level_replaces_the_workout_with_recovery(client, lena):
    today = date.today().isoformat()
    bench = exercises_by_name(client, lena)["Barbell Bench Press"]
    program = create_program(client, lena, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    client.post("/api/cycle/start", json={"day": today, "checkin": {**CHECKIN, "day": today, "cramps": 3}}, headers=as_user(lena))
    session = client.post("/api/sessions", json={"day": today, "program_id": program["id"]}, headers=as_user(lena)).json()
    names = [entry["exercise_name"] for entry in session["exercises"]]
    assert "Barbell Bench Press" not in names
    assert names
    assert all(entry["target"] for entry in session["exercises"])


def test_health_page_needs_the_pin(client, lena):
    assert client.get("/api/cycle/health", headers=as_user(lena)).status_code == 423
    headers = unlock(client, lena)
    health = client.get("/api/cycle/health", headers=headers).json()
    assert health["summary"]["regularity"] == "not enough data yet"
    assert client.post("/api/cycle/pin", json={"pin": "1111"}, headers=as_user(lena)).status_code == 403
    assert client.post("/api/cycle/unlock", json={"pin": "0000"}, headers=as_user(lena)).status_code == 403
    assert client.post("/api/cycle/unlock", json={"pin": "2468"}, headers=as_user(lena)).status_code == 200


def test_health_unlock_is_throttled(client, lena):
    unlock(client, lena)
    for _ in range(5):
        client.post("/api/cycle/unlock", json={"pin": "0000"}, headers=as_user(lena))
    assert client.post("/api/cycle/unlock", json={"pin": "2468"}, headers=as_user(lena)).status_code == 429


def test_periods_can_be_added_edited_and_exported(client, lena):
    headers = unlock(client, lena)
    client.post("/api/cycle/periods", json={"start_day": "2026-01-01", "end_day": "2026-01-05"}, headers=headers)
    stats = client.post("/api/cycle/periods", json={"start_day": "2026-01-29", "end_day": "2026-02-02"}, headers=headers).json()
    assert stats["lengths"] == [{"start": "2026-01-01", "length": 28}]
    first = next(cycle for cycle in stats["cycles"] if cycle["start"] == "2026-01-01")
    conflict = client.put("/api/cycle/periods/" + str(first["id"]), json={"start_day": "2026-01-29"}, headers=headers)
    assert conflict.status_code == 409
    assert client.post("/api/cycle/periods", json={"start_day": "2026-01-10", "end_day": "2026-01-01"}, headers=headers).status_code == 400
    exported = client.get("/api/cycle/export", params={"token": headers["X-Health-Token"]})
    assert exported.status_code == 200
    assert len(exported.json()["periods"]) == 2
    report = client.get("/api/cycle/report", params={"token": headers["X-Health-Token"]})
    assert "Cycle report" in report.text
    assert client.get("/api/cycle/export", params={"token": "1.2.bad"}).status_code in (403, 423)


def test_erase_needs_the_pin(client, lena):
    unlock(client, lena)
    assert client.post("/api/cycle/erase", json={"pin": "0000"}, headers=as_user(lena)).status_code == 403
    assert client.post("/api/cycle/erase", json={"pin": "2468"}, headers=as_user(lena)).json() == {"erased": True}
    assert client.get("/api/cycle/state", headers=as_user(lena)).json()["pin_set"] is False


def test_admin_settings_are_locked_to_the_main_account(client):
    admin = create_user(client, "Admin")
    other = create_user(client, "Other")
    assert client.get("/api/admin/state", headers=as_user(other)).json()["allowed"] is False
    assert client.post("/api/admin/unlock", json={"pin": "1234"}, headers=as_user(other)).status_code == 403
    state = client.get("/api/admin/state", headers=as_user(admin)).json()
    assert state == {"pin_set": False, "allowed": True, "unlocked": False}
    assert client.post("/api/admin/unlock", json={"pin": "12"}, headers=as_user(admin)).status_code == 400
    token = client.post("/api/admin/unlock", json={"pin": "1234"}, headers=as_user(admin)).json()["token"]
    headers = {**as_user(admin), "X-Admin-Token": token}
    view = client.get("/api/admin/settings", headers=headers).json()
    key_field = next(field for field in view["fields"] if field["key"] == "gemini_api_key")
    assert key_field["value"] == ""
    saved = client.put("/api/admin/settings", json={"values": {"gemini_api_key": "abcdefghijkl1234", "auto_video": False}}, headers=headers).json()
    key_field = next(field for field in saved["fields"] if field["key"] == "gemini_api_key")
    assert key_field["preview"].endswith("1234")
    assert key_field["source"] == "app"
    assert config.get("gemini_api_key") == "abcdefghijkl1234"
    assert client.put("/api/admin/settings", json={"values": {"nope": 1}}, headers=headers).status_code == 400
    client.post("/api/admin/lock", headers=headers)
    assert client.get("/api/admin/settings", headers=headers).status_code == 401


def test_pantry_webhook_signature(client, monkeypatch):
    values = {"pantry_webhook_secret": "s3cret", "pantry_enabled": "1", "pantry_url": "http://pantry", "pantry_token": "t"}
    monkeypatch.setattr(config, "get", lambda key: values.get(key, ""))
    body = json.dumps({"type": "ping"}).encode()
    stamp = str(int(time.time()))
    signature = "sha256=" + hmac.new(b"s3cret", (stamp + ".").encode() + body, hashlib.sha256).hexdigest()
    bad = client.post("/api/integrations/pantry", content=body, headers={"X-Pantry-Timestamp": "soon", "X-Pantry-Signature": signature})
    assert bad.status_code == 401
    ignored = client.post("/api/integrations/pantry", content=json.dumps({"type": "other"}).encode(), headers={"X-Pantry-Timestamp": stamp, "X-Pantry-Signature": "x"})
    assert ignored.status_code == 401
    monkeypatch.setattr("nutrition._safe_sync", lambda day=None: None)
    good = client.post("/api/integrations/pantry", content=body, headers={"X-Pantry-Timestamp": stamp, "X-Pantry-Signature": signature})
    assert good.json() == {"ok": True}


def test_nutrition_week_summary(client):
    user_id = create_user(client)
    today = date.today().isoformat()
    with db.transaction() as conn:
        conn.execute("INSERT INTO nutrition_days (user_id, day, kcal, protein, entries, synced_at) VALUES (?, ?, 2000, 150, ?, ?)",
                     (user_id, today, json.dumps([{"name": "Rice"}]), db.now_iso()))
    data = client.get("/api/nutrition/week", headers=as_user(user_id)).json()
    assert data["logged_days"] == 1
    assert data["average"]["kcal"] == 2000
    assert data["status"]["enabled"] is False


def test_single_page_app_fallback(client):
    import main

    web = main.WEB_DIR
    web.mkdir(parents=True, exist_ok=True)
    (web / "index.html").write_text("<!doctype html><title>Home Gym</title>")
    (web / "manifest.webmanifest").write_text("{}")
    page = client.get("/programs/12")
    assert page.status_code == 200
    assert "Home Gym" in page.text
    assert page.headers["cache-control"] == "no-cache"
    assert client.get("/manifest.webmanifest").text == "{}"
    assert client.get("/api/does-not-exist").status_code == 404
    assert client.get("/../etc/passwd").status_code in (200, 404)
    assert "root:" not in client.get("/..%2F..%2Fetc%2Fpasswd").text
    assert client.get("/healthz").json() == {"ok": True}


def test_quality_page_is_served_outside_the_single_page_app(client):
    response = client.get("/quality")
    assert response.status_code == 200
    assert "Program Quality" in response.text
    assert response.headers["cache-control"] == "no-cache"

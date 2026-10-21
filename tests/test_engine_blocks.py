from datetime import date, timedelta

import pytest

import db
import engine
from conftest import as_user, create_program, create_user, exercises_by_name, finish, log_sets, start_session


def monday():
    today = date.today()
    return today - timedelta(days=today.weekday())


def test_first_block_starts_on_monday_with_the_configured_length(client):
    user_id = create_user(client)
    with db.as_user(user_id):
        block = engine.ensure_block()
        state = engine.block_state(block)
    assert block["start_day"] == monday().isoformat()
    assert block["weeks"] == 5
    assert state["week"] == 1
    assert state["deload_from"] == (monday() + timedelta(days=28)).isoformat()


def test_fatigue_is_only_noted_in_the_first_week(client):
    user_id = create_user(client)
    response = client.post("/api/coach/fatigue", headers=as_user(user_id)).json()
    assert response == {"started": False, "message": "Noted. The block is too young for a deload."}


def test_manual_deload_shortens_the_block(client):
    user_id = create_user(client)
    assert client.post("/api/coach/deload", headers=as_user(user_id)).json() == {"started": True}
    assert client.post("/api/coach/deload", headers=as_user(user_id)).json() == {"started": False}
    with db.as_user(user_id):
        block = engine.active_block()
    assert block["deload_from"] == date.today().isoformat()


def test_block_review_waits_for_the_ai_and_logs_it(client):
    user_id = create_user(client)
    with db.as_user(user_id):
        engine.ensure_block(monday() - timedelta(days=70))
        with db.transaction() as conn:
            conn.execute("UPDATE blocks SET start_day = ? WHERE user_id = ?", ((monday() - timedelta(days=70)).isoformat(), user_id))
        block = engine.ensure_block()
    assert block["number"] == 1
    waiting = db.query_all("SELECT kind FROM coach_log WHERE user_id = ?", (user_id,))
    assert [row["kind"] for row in waiting] == ["ai_waiting"]


def test_forced_review_with_ai_swaps_too_easy_bodyweight_exercises(client, fake_ai):
    user_id = create_user(client)
    exercises = exercises_by_name(client, user_id)
    bodyweight = next(item for item in exercises.values() if item["measure"] == "reps" and not item["track_weight"] and item["available"] and item["primary_muscle"] == "abs")
    program = create_program(client, user_id, [{"exercise_id": bodyweight["id"], "sets": 3, "rep_min": 20, "rep_max": 25, "rest_seconds": 60}])
    with db.transaction() as conn:
        conn.execute("UPDATE program_exercises SET added_block = 0 WHERE program_id = ?", (program["id"],))
    summary = client.post("/api/coach/review", headers=as_user(user_id)).json()["summary"]
    assert any(line.startswith("Swapped: " + bodyweight["name"]) for line in summary)
    assert ("swap", bodyweight["name"]) in fake_ai.calls
    with db.as_user(user_id):
        block = engine.active_block()
    assert block["number"] == 2
    log = db.query_one("SELECT * FROM coach_log WHERE kind = 'block_review' AND user_id = ?", (user_id,))
    assert "Solid block." in log["message"]


def test_review_endpoint_reports_missing_ai(client):
    user_id = create_user(client)
    response = client.post("/api/coach/review", headers=as_user(user_id))
    assert response.status_code == 503
    assert "AI coach is not ready" in response.json()["detail"]


def test_muscle_volume_counts_secondary_muscles_half(client):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 4, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    with db.as_user(user_id):
        volume, per_session = engine.muscle_volume()
    assert volume["chest"] == 4
    for muscle in bench["secondary_muscles"]:
        assert volume[muscle] == pytest.approx(2)
    assert list(per_session.values()) == [4]


def test_bodyweight_trend_compares_weeks(client):
    user_id = create_user(client)
    today = date.today()
    for offset, weight in ((15, 82), (16, 82), (1, 80), (2, 80)):
        client.put("/api/body", json={"day": (today - timedelta(days=offset)).isoformat(), "weight_kg": weight}, headers=as_user(user_id))
    with db.as_user(user_id):
        trend = engine.bodyweight_trend()
    assert trend["avg7"] == pytest.approx(80, abs=0.01)
    assert trend["weekly_rate"] == pytest.approx((80 / 82 - 1) / 2)


def test_seed_target_weights_from_history(client):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    first = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 1, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    session = start_session(client, user_id, first["id"], monday().isoformat())
    log_sets(client, user_id, session["exercises"][0], [10], weight=55)
    finish(client, user_id, session["id"])
    second = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}], name="Second")
    with db.as_user(user_id):
        engine.seed_target_weights()
    item = db.query_one("SELECT target_weight FROM program_exercises WHERE program_id = ?", (second["id"],))
    assert item["target_weight"] == 55

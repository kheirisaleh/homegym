from datetime import date, timedelta

from conftest import as_user, create_program, create_user, exercises_by_name, finish, log_sets, start_session


def train(client, user_id, when, weight, reps=10):
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    programs = client.get("/api/programs", headers=as_user(user_id)).json()
    program = programs[0] if programs else create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 2, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    session = start_session(client, user_id, program["id"], when.isoformat())
    log_sets(client, user_id, session["exercises"][0], [reps, reps], weight=weight)
    return finish(client, user_id, session["id"])


def test_dashboard_for_a_new_user(client):
    user_id = create_user(client)
    data = client.get("/api/dashboard", headers=as_user(user_id)).json()
    assert data["stats"] == {"total": 0, "this_week": 0, "this_month": 0, "streak_weeks": 0, "last_day": None}
    assert data["strength"] == []
    assert data["block"]["week"] == 1
    assert data["body"][0]["weight_kg"] == 80


def test_dashboard_tracks_streak_strength_and_records(client):
    user_id = create_user(client)
    today = date.today()
    train(client, user_id, today - timedelta(days=14), 40)
    train(client, user_id, today - timedelta(days=7), 45)
    train(client, user_id, today, 50)
    data = client.get("/api/dashboard", params={"today": today.isoformat()}, headers=as_user(user_id)).json()
    assert data["stats"]["total"] == 3
    assert data["stats"]["streak_weeks"] == 3
    assert data["stats"]["last_day"] == today.isoformat()
    strength = data["strength"][0]
    assert strength["name"] == "Barbell Bench Press"
    assert strength["count"] == 3
    assert strength["change"] > 0.2
    assert data["strength_index"][0]["value"] == 100
    assert [record["weight"] for record in data["prs"]] == [50, 45]
    assert data["heatmap"][-1]["sets"] == 2
    assert client.get("/api/stats", headers=as_user(user_id)).json()["total"] == 3


def test_body_entries_can_be_saved_and_cleared(client):
    user_id = create_user(client)
    day = "2026-02-02"
    saved = client.put("/api/body", json={"day": day, "weight_kg": 79.5, "waist_cm": 84}, headers=as_user(user_id)).json()
    assert {"day": day, "weight_kg": 79.5, "waist_cm": 84} in saved["entries"]
    cleared = client.put("/api/body", json={"day": day}, headers=as_user(user_id)).json()
    assert all(entry["day"] != day for entry in cleared["entries"])
    assert client.put("/api/body", json={"day": day, "weight_kg": 0}, headers=as_user(user_id)).status_code == 422


def test_leaderboard_scores_consistency_and_progress(client):
    alex = create_user(client, "Alex")
    sam = create_user(client, "Sam")
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    train(client, alex, monday - timedelta(days=7), 40)
    train(client, alex, monday, 50)
    data = client.get("/api/leaderboard", params={"period": "week", "today": today.isoformat()}).json()
    rows = {row["name"]: row for row in data["rows"]}
    assert rows["Alex"]["rank"] == 1
    assert rows["Alex"]["records"] == 1
    assert rows["Alex"]["points"]["records"] == 4
    assert rows["Sam"]["score"] == 0
    assert data["categories"]["records"]["id"] == alex
    assert sam not in [entry["id"] for entry in data["categories"].values()]


def test_coach_state_and_settings(client):
    user_id = create_user(client)
    state = client.get("/api/coach", headers=as_user(user_id)).json()
    assert state["block"]["number"] == 1
    assert state["settings"]["block_weeks"] == 5
    assert state["volume_targets"] == {"normal": [10, 20], "priority": [14, 22]}
    updated = client.put("/api/coach/settings", json={"priority_muscles": ["biceps", "wings"], "goal_fat_loss": True, "block_weeks": 6, "cardio_target_min": 200},
                         headers=as_user(user_id)).json()
    assert updated["priority_muscles"] == ["biceps"]
    assert updated["goal_fat_loss"] is True
    assert updated["block_weeks"] == 6
    assert client.put("/api/coach/settings", json={"block_weeks": 9}, headers=as_user(user_id)).status_code == 422


def test_ai_status_without_key(client):
    status = client.get("/api/ai/status").json()
    assert status["ready"] is False
    assert status["key_set"] is False
    assert status["message"].startswith("No Gemini API key yet")


def test_coach_today_and_brief_use_rule_based_text(client):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    today = date.today()
    program = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}],
                             weekday=today.weekday())
    data = client.get("/api/coach/today", params={"day": today.isoformat()}, headers=as_user(user_id)).json()
    assert data["program"]["id"] == program["id"]
    assert data["brief"]["source"] == "rule"
    assert "Barbell Bench Press" in data["brief"]["message"]
    brief = client.get("/api/coach/brief", params={"day": today.isoformat(), "program_id": program["id"]}, headers=as_user(user_id)).json()
    assert brief["persona"]["coach"] == "max"
    assert client.get("/api/coach/brief", params={"day": "x"}, headers=as_user(user_id)).status_code == 400


def test_outro_after_finishing_and_singular_wording(client):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    program = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 1, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    session = start_session(client, user_id, program["id"], date.today().isoformat())
    assert client.get("/api/sessions/" + str(session["id"]) + "/outro", headers=as_user(user_id)).status_code == 409
    log_sets(client, user_id, session["exercises"][0], [10], weight=40)
    finish(client, user_id, session["id"])
    outro = client.get("/api/sessions/" + str(session["id"]) + "/outro", params={"refresh": True}, headers=as_user(user_id)).json()
    assert "1 set in" in outro["message"]
    assert outro["source"] == "rule"


def test_feedback_and_rest_tip(client):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    program = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    session = start_session(client, user_id, program["id"], date.today().isoformat())
    entry = session["exercises"][0]
    log_sets(client, user_id, entry, [12], weight=40)
    tip = client.get("/api/session-exercises/" + str(entry["id"]) + "/tip", headers=as_user(user_id)).json()
    assert tip["tips"][0].startswith("Top of the range")
    saved = client.post("/api/session-exercises/" + str(entry["id"]) + "/feedback", json={"rating": "pain", "note": " shoulder "}, headers=as_user(user_id)).json()
    assert saved == {"session_exercise_id": entry["id"], "rating": "pain", "note": "shoulder"}
    listed = client.get("/api/sessions/" + str(session["id"]) + "/feedback", headers=as_user(user_id)).json()
    assert listed == {str(entry["id"]): {"rating": "pain", "note": "shoulder"}}
    client.delete("/api/session-exercises/" + str(entry["id"]) + "/feedback", headers=as_user(user_id))
    assert client.get("/api/sessions/" + str(session["id"]) + "/feedback", headers=as_user(user_id)).json() == {}

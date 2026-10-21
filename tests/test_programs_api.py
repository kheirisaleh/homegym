from datetime import date, timedelta

import db
from conftest import as_user, create_program, create_user, exercises_by_name, finish, log_sets, start_session


def bench_item(client, user_id, **overrides):
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    return {"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90, **overrides}


def test_create_program_builds_targets_from_ranges_and_text(client):
    user_id = create_user(client)
    exercises = exercises_by_name(client, user_id)
    program = create_program(client, user_id, [
        bench_item(client, user_id, rep_min=12, rep_max=8),
        {"exercise_id": exercises["Plank"]["id"], "sets": 2, "target": "30-45", "rest_seconds": 60},
        {"exercise_id": exercises["Walking"]["id"], "sets": 1, "rep_min": 20, "rest_seconds": 0},
    ])
    items = program["items"]
    assert [item["target"] for item in items] == ["8–12", "30–45 s", "20 min"]
    assert (items[0]["rep_min"], items[0]["rep_max"]) == (8, 12)
    assert program["total_sets"] == 5


def test_program_rejects_unknown_exercise(client):
    user_id = create_user(client)
    response = client.post("/api/programs", json={"name": "X", "items": [{"exercise_id": 99999, "sets": 3}]}, headers=as_user(user_id))
    assert response.status_code == 400


def test_programs_are_private_per_user(client):
    alex = create_user(client, "Alex")
    sam = create_user(client, "Sam")
    program = create_program(client, alex, [bench_item(client, alex)])
    assert client.get("/api/programs/" + str(program["id"]), headers=as_user(sam)).status_code == 404
    assert client.delete("/api/programs/" + str(program["id"]), headers=as_user(sam)).status_code == 404
    assert client.get("/api/programs", headers=as_user(sam)).json() == []


def test_edit_keeps_learned_weight_and_coach_cue(client):
    user_id = create_user(client)
    program = create_program(client, user_id, [bench_item(client, user_id, target_weight=60)])
    with db.transaction() as conn:
        conn.execute("UPDATE program_exercises SET cue = 'Elbows tucked' WHERE program_id = ?", (program["id"],))
    item = bench_item(client, user_id, sets=4)
    updated = client.put("/api/programs/" + str(program["id"]), json={"name": "Push day", "weekday": 2, "items": [item]}, headers=as_user(user_id)).json()
    assert updated["items"][0]["target_weight"] == 60
    assert updated["items"][0]["cue"] == "Elbows tucked"
    assert updated["items"][0]["sets"] == 4
    assert updated["weekday"] == 2


def test_restoring_a_version_brings_back_sets_and_cue(client):
    user_id = create_user(client)
    program = create_program(client, user_id, [bench_item(client, user_id)])
    with db.transaction() as conn:
        conn.execute("UPDATE program_exercises SET cue = 'Pause on the chest' WHERE program_id = ?", (program["id"],))
    client.put("/api/programs/" + str(program["id"]), json={"name": "Push", "items": [bench_item(client, user_id, sets=5)]}, headers=as_user(user_id))
    detail = client.get("/api/programs/" + str(program["id"]), headers=as_user(user_id)).json()
    version = detail["versions"][0]
    assert version["reason"] == "Manual edit"
    restored = client.post("/api/programs/" + str(program["id"]) + "/restore/" + str(version["id"]), headers=as_user(user_id)).json()
    assert restored["items"][0]["sets"] == 3
    assert restored["items"][0]["cue"] == "Pause on the chest"


def test_duplicate_creates_independent_copy(client):
    user_id = create_user(client)
    program = create_program(client, user_id, [bench_item(client, user_id)], weekday=1)
    copy = client.post("/api/programs/" + str(program["id"]) + "/duplicate", headers=as_user(user_id)).json()
    assert copy["name"] == "Push copy"
    assert copy["weekday"] is None
    assert copy["id"] != program["id"]
    assert len(copy["items"]) == 1


def test_delete_archives_programs_that_have_history(client):
    user_id = create_user(client)
    used = create_program(client, user_id, [bench_item(client, user_id)], name="Used")
    unused = create_program(client, user_id, [bench_item(client, user_id)], name="Unused")
    session = start_session(client, user_id, used["id"], "2026-01-05")
    log_sets(client, user_id, session["exercises"][0], [10], weight=40)
    finish(client, user_id, session["id"])
    client.delete("/api/programs/" + str(used["id"]), headers=as_user(user_id))
    client.delete("/api/programs/" + str(unused["id"]), headers=as_user(user_id))
    archived = db.query_one("SELECT archived FROM programs WHERE id = ?", (used["id"],))
    assert archived["archived"] == 1
    assert db.query_one("SELECT id FROM programs WHERE id = ?", (unused["id"],)) is None
    assert client.get("/api/programs", headers=as_user(user_id)).json() == []


def test_suggestions_prefer_today_and_unused_programs(client):
    user_id = create_user(client)
    today = date(2026, 3, 4)
    create_program(client, user_id, [bench_item(client, user_id)], name="Today", weekday=today.weekday())
    other = create_program(client, user_id, [bench_item(client, user_id)], name="Other", weekday=(today.weekday() + 2) % 7)
    data = client.get("/api/suggestions", params={"day": today.isoformat()}, headers=as_user(user_id)).json()
    options = data["options"]
    assert options[0]["program"]["name"] == "Today"
    assert options[0]["suggested"] is True
    assert options[0]["reason"] == "Today in your weekly plan"
    session = start_session(client, user_id, other["id"], (today - timedelta(days=3)).isoformat())
    log_sets(client, user_id, session["exercises"][0], [10], weight=40)
    finish(client, user_id, session["id"])
    again = client.get("/api/suggestions", params={"day": today.isoformat()}, headers=as_user(user_id)).json()
    other_entry = next(option for option in again["options"] if option["program"]["name"] == "Other")
    assert other_entry["reason"] == "Last done 3 days ago"


def test_suggestions_validate_day(client):
    user_id = create_user(client)
    assert client.get("/api/suggestions", params={"day": "yesterday"}, headers=as_user(user_id)).status_code == 400

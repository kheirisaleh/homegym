from datetime import date, timedelta

import db
import engine
from conftest import as_user, create_program, create_user, exercises_by_name, finish, log_sets, start_session


def monday():
    today = date.today()
    return today - timedelta(days=today.weekday())


def day(offset):
    return (monday() + timedelta(days=offset)).isoformat()


def bench_program(client, user_id, sets=3, extra=()):
    exercises = exercises_by_name(client, user_id)
    items = [{"exercise_id": exercises["Barbell Bench Press"]["id"], "sets": sets, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}]
    items += [{"exercise_id": exercises[name]["id"], "sets": sets, "rep_min": 8, "rep_max": 12, "rest_seconds": 90} for name in extra]
    return create_program(client, user_id, items)


def program_item(program_id):
    return db.query_one("SELECT * FROM program_exercises WHERE program_id = ? ORDER BY position LIMIT 1", (program_id,))


def run_session(client, user_id, program, when, reps, weight):
    session = start_session(client, user_id, program["id"], when)
    for entry in session["exercises"]:
        log_sets(client, user_id, entry, reps, weight=weight)
    return finish(client, user_id, session["id"])


def test_only_one_active_workout_per_user(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    start_session(client, user_id, program["id"], day(0))
    second = client.post("/api/sessions", json={"day": day(0), "program_id": program["id"]}, headers=as_user(user_id))
    assert second.status_code == 409
    active = client.get("/api/sessions/active", headers=as_user(user_id)).json()
    assert active["program_name"] == "Push"
    assert active["exercises"][0]["planned_sets"] == 3


def test_sets_are_numbered_and_renumbered_after_delete(client):
    user_id = create_user(client)
    session = start_session(client, user_id, bench_program(client, user_id)["id"], day(0))
    entry = session["exercises"][0]
    log_sets(client, user_id, entry, [10, 9, 8], weight=40)
    sets = client.get("/api/sessions/" + str(session["id"]), headers=as_user(user_id)).json()["exercises"][0]["sets"]
    assert [item["set_number"] for item in sets] == [1, 2, 3]
    client.delete("/api/sets/" + str(sets[0]["id"]), headers=as_user(user_id))
    remaining = client.get("/api/sessions/" + str(session["id"]), headers=as_user(user_id)).json()["exercises"][0]["sets"]
    assert [(item["set_number"], item["value"]) for item in remaining] == [(1, 9), (2, 8)]
    edited = client.put("/api/sets/" + str(remaining[0]["id"]), json={"value": 11, "weight": 42.5, "effort": 2}, headers=as_user(user_id)).json()
    assert (edited["value"], edited["weight"], edited["effort"]) == (11, 42.5, 2)


def test_sets_of_other_users_are_hidden(client):
    alex = create_user(client, "Alex")
    sam = create_user(client, "Sam")
    session = start_session(client, alex, bench_program(client, alex)["id"], day(0))
    entry = session["exercises"][0]
    response = client.post("/api/sets", json={"session_exercise_id": entry["id"], "value": 10}, headers=as_user(sam))
    assert response.status_code == 404
    assert client.get("/api/sessions/" + str(session["id"]), headers=as_user(sam)).status_code == 404


def test_personal_record_is_reported_when_beating_history(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    run_session(client, user_id, program, day(0), [10, 10, 10], 40)
    session = start_session(client, user_id, program["id"], day(2))
    entry = session["exercises"][0]
    weaker = client.post("/api/sets", json={"session_exercise_id": entry["id"], "value": 8, "weight": 40}, headers=as_user(user_id)).json()
    assert weaker["record"] is None
    stronger = client.post("/api/sets", json={"session_exercise_id": entry["id"], "value": 10, "weight": 45}, headers=as_user(user_id)).json()
    assert stronger["record"]["current"] > stronger["record"]["previous"]


def test_double_progression_sets_raises_and_lowers_the_weight(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    first = run_session(client, user_id, program, day(0), [9, 9, 8], 40)
    assert first["changes"] == [{"exercise": "Barbell Bench Press", "kind": "weight_set", "weight": 40}]
    assert program_item(program["id"])["target_weight"] == 40
    top = run_session(client, user_id, program, day(2), [12, 12, 12], 40)
    assert top["changes"][0]["kind"] == "weight_up"
    assert program_item(program["id"])["target_weight"] == 42.5
    run_session(client, user_id, program, day(4), [6, 6, 6], 42.5)
    assert program_item(program["id"])["miss_count"] == 1
    down = run_session(client, user_id, program, day(7), [6, 6, 6], 42.5)
    assert down["changes"][0]["kind"] == "weight_down"
    assert program_item(program["id"])["target_weight"] == 40


def test_progression_changes_can_be_undone(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    run_session(client, user_id, program, day(0), [9, 9, 9], 40)
    run_session(client, user_id, program, day(2), [12, 12, 12], 40)
    entry = db.query_one("SELECT id FROM coach_log WHERE kind = 'weight_up' AND user_id = ?", (user_id,))
    assert client.post("/api/coach/log/" + str(entry["id"]) + "/undo", headers=as_user(user_id)).status_code == 200
    assert program_item(program["id"])["target_weight"] == 40
    assert client.post("/api/coach/log/" + str(entry["id"]) + "/undo", headers=as_user(user_id)).status_code == 400


def test_deload_week_halves_the_planned_sets(client):
    user_id = create_user(client)
    program = bench_program(client, user_id, sets=5)
    session = start_session(client, user_id, program["id"], day(28))
    assert session["deload"] == 1
    assert session["exercises"][0]["planned_sets"] == 3


def test_early_deload_triggers_after_two_clearly_weaker_workouts(client):
    user_id = create_user(client)
    program = bench_program(client, user_id, extra=["Barbell Back Squat"])
    for offset in (0, 3, 7, 10):
        run_session(client, user_id, program, day(offset), [10, 10, 10], 60)
    with db.as_user(user_id):
        assert engine.block_state(engine.active_block(), day(14))["week"] == 3
    run_session(client, user_id, program, day(14), [10, 10, 10], 40)
    with db.as_user(user_id):
        assert engine.active_block()["deload_from"] is None
    run_session(client, user_id, program, day(17), [10, 10, 10], 40)
    with db.as_user(user_id):
        block = engine.active_block()
    assert block["deload_from"] == day(17)
    assert block["weeks"] == 4
    assert db.query_one("SELECT 1 AS ok FROM coach_log WHERE kind = 'deload_start' AND user_id = ?", (user_id,))


def test_finishing_in_week_three_does_not_fail(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    result = run_session(client, user_id, program, day(15), [10, 10, 10], 50)
    assert result["status"] == "done"


def test_reopen_and_delete_workout(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    done = run_session(client, user_id, program, day(0), [10], 40)
    start_session(client, user_id, program["id"], day(1))
    assert client.post("/api/sessions/" + str(done["id"]) + "/reopen", headers=as_user(user_id)).status_code == 409
    active = client.get("/api/sessions/active", headers=as_user(user_id)).json()
    client.delete("/api/sessions/" + str(active["id"]), headers=as_user(user_id))
    reopened = client.post("/api/sessions/" + str(done["id"]) + "/reopen", headers=as_user(user_id)).json()
    assert reopened["status"] == "active"


def test_free_workout_can_add_and_remove_exercises(client):
    user_id = create_user(client)
    session = client.post("/api/sessions", json={"day": day(0), "program_id": None}, headers=as_user(user_id)).json()
    assert session["program_name"] == "Free workout"
    plank = exercises_by_name(client, user_id)["Plank"]
    updated = client.post("/api/sessions/" + str(session["id"]) + "/exercises", json={"exercise_id": plank["id"], "sets": 2, "target": "30 s"},
                          headers=as_user(user_id)).json()
    entry = updated["exercises"][0]
    assert entry["exercise_name"] == "Plank"
    client.put("/api/session-exercises/" + str(entry["id"]) + "/planned", json={"sets": 4}, headers=as_user(user_id))
    client.put("/api/sessions/" + str(session["id"]) + "/state", json={"current_index": 0}, headers=as_user(user_id))
    detail = client.get("/api/sessions/" + str(session["id"]), headers=as_user(user_id)).json()
    assert detail["exercises"][0]["planned_sets"] == 4
    client.delete("/api/session-exercises/" + str(entry["id"]), headers=as_user(user_id))
    assert client.get("/api/sessions/" + str(session["id"]), headers=as_user(user_id)).json()["exercises"] == []


def test_previous_sets_and_exercise_history(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    run_session(client, user_id, program, day(0), [10, 9], 40)
    session = start_session(client, user_id, program["id"], day(2))
    previous = session["exercises"][0]["previous"]
    assert previous["day"] == day(0)
    assert [item["value"] for item in previous["sets"]] == [10, 9]
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    history = client.get("/api/exercises/" + str(bench["id"]) + "/history", headers=as_user(user_id)).json()
    assert len(history["entries"]) == 1
    assert history["entries"][0]["top_weight"] == 40
    assert history["entries"][0]["volume"] == 760


def test_session_list_filters_by_range(client):
    user_id = create_user(client)
    program = bench_program(client, user_id)
    run_session(client, user_id, program, day(0), [10], 40)
    run_session(client, user_id, program, day(5), [10], 40)
    sessions = client.get("/api/sessions", params={"start": day(3), "end": day(6)}, headers=as_user(user_id)).json()
    assert [item["day"] for item in sessions] == [day(5)]
    assert sessions[0]["sets_done"] == 1
    assert sessions[0]["volume"] == 400
    assert client.get("/api/sessions", params={"start": "bad"}, headers=as_user(user_id)).status_code == 400

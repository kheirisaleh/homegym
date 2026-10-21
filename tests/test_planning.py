import re
from datetime import date

import pytest

import ai
import architect
import db
import engine
import onboarding
import planner
import reviewer
from conftest import as_user, create_program, create_user, exercises_by_name, finish, log_sets, start_session


def profile(**overrides):
    return {
        "name": "Alex", "sex": "male", "age": 30, "height_cm": 180, "weight_kg": 80, "experience": "none", "trained_recently": False,
        "goal": "muscle", "days_per_week": 4, "session_minutes": 60, "priority_muscles": ["chest"], "limitations": "", **overrides,
    }


def library_and_equipment(client):
    create_user(client, "Planner")
    return engine.library_exercises(), db.equipment_map()


@pytest.mark.parametrize("days", [1, 2, 3, 4, 5, 6])
def test_classic_planner_builds_one_day_per_training_day(client, days):
    library, equipment = library_and_equipment(client)
    plan = planner.build_plan(profile(days_per_week=days, experience="over_2_years", trained_recently=True), library, equipment)
    weekdays = [day["weekday"] for day in plan["days"]]
    assert len(weekdays) == days
    assert len(set(weekdays)) == days
    for day in plan["days"]:
        for slot in day["slots"]:
            assert slot["candidates"]
            assert all(engine.available_exercise(exercise, equipment) for exercise in slot["candidates"])
        assert sum(slot["sets"] for slot in day["slots"]) <= plan["session_set_cap"]


def test_beginners_get_full_body_and_easy_exercises(client):
    library, equipment = library_and_equipment(client)
    plan = planner.build_plan(profile(days_per_week=5), library, equipment)
    assert plan["level"] == "beginner"
    kinds = [day["kind"] for day in plan["days"]]
    assert kinds.count("strength") == 3
    assert kinds.count("cardio") == 2
    for day in plan["days"]:
        for slot in day["slots"]:
            assert all(exercise["difficulty"] <= 2 for exercise in slot["candidates"])
    report = planner.write_report(plan, equipment)
    assert report.startswith("# Training brief for Alex")


def test_obese_profiles_get_no_interval_cardio(client):
    library, equipment = library_and_equipment(client)
    plan = planner.build_plan(profile(weight_kg=130, goal="fat_loss", days_per_week=5), library, equipment)
    assert plan["bmi_label"] == "obese"
    for day in plan["days"]:
        assert all(exercise["pattern"] != "cardio_interval" for exercise in day["cardio_candidates"])


def test_onboarding_falls_back_to_the_classic_planner(client, fake_ai, monkeypatch):
    user_id = create_user(client, "Newbie", days_per_week=3)
    with db.transaction() as conn:
        conn.execute("UPDATE users SET status = 'generating' WHERE id = ?", (user_id,))

    def broken_design(*args, **kwargs):
        raise architect.ArchitectError("draft failed")

    monkeypatch.setattr(architect, "design_program", broken_design)
    monkeypatch.setattr(ai, "write_first_program", lambda report, feedback="": {"summary": "Three full body days.", "days": []})
    onboarding.generate(user_id)
    user = client.get("/api/me", headers=as_user(user_id)).json()
    assert user["status"] == "ready"
    assert user["plan_summary"] == "Three full body days."
    programs = client.get("/api/programs", headers=as_user(user_id)).json()
    assert len(programs) == 3
    assert all(program["items"] for program in programs)


def test_onboarding_waits_when_the_ai_is_offline(client):
    user_id = create_user(client, "Patient")
    onboarding.generate(user_id)
    user = client.get("/api/me", headers=as_user(user_id)).json()
    assert user["status"] == "waiting_ai"
    assert user["status_message"].startswith("Waiting for the AI coach")


def fake_architect_ai(monkeypatch, score=93):
    calls = []

    def chat_json(prompt, schema, **kwargs):
        calls.append(schema)
        if schema is architect.ASSESS_SCHEMA:
            return {"understanding": "Healthy adult.", "priority_muscles": ["chest"], "avoid_exercise_ids": [], "pull_to_push_ratio": 1.0,
                    "lifting_days": 3, "design_notes": "Full body."}
        if schema is architect.CRITIC_SCHEMA:
            return {"score": score, "verdict": "Good", "issues": []}
        weekdays = [int(value) for value in re.findall(r"\((\d)\)", prompt.split("Training days per week:")[1].split("\n")[0])]
        ids = [int(value) for value in re.findall(r"id=(\d+) ", prompt.split("=== EXERCISE LIBRARY")[1])]
        return {"summary": "Your plan.", "split": "Full body", "days": [
            {"weekday": weekday, "name": "Day " + str(index + 1), "focus": "Full body", "note": "Move well.",
             "items": [{"exercise_id": exercise_id, "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90, "cue": "Brace."}
                       for exercise_id in ids[index * 5:index * 5 + 5]]}
            for index, weekday in enumerate(weekdays)]}

    monkeypatch.setattr(ai, "chat_json", chat_json)
    return calls


def test_architect_designs_reviews_and_applies_a_program(client, fake_ai, monkeypatch):
    calls = fake_architect_ai(monkeypatch)
    user_id = create_user(client, "Designer", days_per_week=3)
    old = create_program(client, user_id, [{"exercise_id": exercises_by_name(client, user_id)["Barbell Bench Press"]["id"], "sets": 3, "rep_min": 8, "rep_max": 12}])
    result = architect.design_program(user_id, {})
    assert architect.ASSESS_SCHEMA in calls and architect.CRITIC_SCHEMA in calls
    created = architect.apply_design(user_id, result)
    programs = client.get("/api/programs", headers=as_user(user_id)).json()
    assert sorted(program["id"] for program in programs) == sorted(created)
    assert [program["weekday"] for program in programs] == [0, 2, 4]
    assert all(item["cue"] == "Brace." for program in programs for item in program["items"])
    run = db.query_one("SELECT kind, attempts FROM ai_runs WHERE user_id = ?", (user_id,))
    assert run["kind"] == "rebuild"
    assert architect.restore_previous(user_id)
    restored = client.get("/api/programs", headers=as_user(user_id)).json()
    assert [program["id"] for program in restored] == [old["id"]]


def test_architect_rejects_answers_without_usable_days(client, fake_ai, monkeypatch):
    fake_architect_ai(monkeypatch)
    original = ai.chat_json

    def no_days(prompt, schema, **kwargs):
        if schema is architect.DESIGN_SCHEMA:
            return {"summary": "", "split": "", "days": [{"weekday": 6, "name": "Wrong day", "focus": "", "note": "", "items": []}]}
        return original(prompt, schema, **kwargs)

    monkeypatch.setattr(ai, "chat_json", no_days)
    user_id = create_user(client, "Unlucky", days_per_week=3)
    with pytest.raises(architect.ArchitectError):
        architect.design_program(user_id, {})


def test_analyse_flags_rule_violations(client):
    user_id = create_user(client, "Rules", days_per_week=3)
    context = architect.build_context(user_id, {})
    context.update(priority=["chest"], pull_ratio=0.8, lifting_days=3, targets=architect.volume_targets(context["level"], ["chest"], context["goal"]))
    some_id = next(iter(context["library_by_id"]))
    design = {"days": [
        {"weekday": 6, "items": []},
        {"weekday": 0, "items": [{"exercise_id": 999999, "sets": 3}, {"exercise_id": some_id, "sets": 9, "rep_min": 8, "rep_max": 12, "rest_seconds": 900},
                                 {"exercise_id": some_id, "sets": 3}]},
    ]}
    analysis = architect.analyse(design, context)
    text = " | ".join(analysis["problems"])
    assert "not in the schedule" in text
    assert "is not allowed" in text
    assert "appears twice" in text
    assert "missing training days" in text
    assert "priority muscle chest" in text


def test_nightly_review_swaps_a_painful_exercise(client, fake_ai, monkeypatch):
    user_id = create_user(client, "Hurt")
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    program = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    session = start_session(client, user_id, program["id"], date.today().isoformat())
    entry = session["exercises"][0]
    log_sets(client, user_id, entry, [10], weight=40)
    client.post("/api/session-exercises/" + str(entry["id"]) + "/feedback", json={"rating": "pain", "note": "shoulder"}, headers=as_user(user_id))
    finish(client, user_id, session["id"])

    def decide(prompt, schema, **kwargs):
        item_id = int(re.search(r"item_id=(\d+)", prompt).group(1))
        candidate = int(re.search(r"candidate exercise_id=(\d+)", prompt).group(1))
        return {"decisions": [{"item_id": item_id, "action": "swap", "exercise_id": candidate, "sets": 3, "rep_min": 10, "rep_max": 15, "cue": "Slow.",
                               "reason": "Kinder to the shoulder."}], "note": "One swap."}

    monkeypatch.setattr(ai, "chat_json", decide)
    result = reviewer.review_user(user_id, force=True)
    assert result["flagged"] == 1
    assert result["changes"] and result["changes"][0].startswith("Barbell Bench Press → ")
    item = client.get("/api/programs/" + str(program["id"]), headers=as_user(user_id)).json()["items"][0]
    assert item["exercise_id"] != bench["id"]
    assert (item["rep_min"], item["rep_max"], item["cue"]) == (10, 15, "Slow.")

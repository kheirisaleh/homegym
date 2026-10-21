from conftest import ONBOARDING, as_user, create_user


def test_first_user_becomes_superuser_and_names_are_unique(client):
    first = create_user(client, "Alex")
    second = create_user(client, "Sam")
    users = {user["id"]: user for user in client.get("/api/users").json()}
    assert users[first]["is_superuser"] == 1
    assert users[second]["is_superuser"] == 0
    duplicate = client.post("/api/users", json={**ONBOARDING, "name": "  alex "})
    assert duplicate.status_code == 409


def test_onboarding_validation_rejects_bad_values(client):
    response = client.post("/api/users", json={**ONBOARDING, "name": "Kim", "goal": "bulk"})
    assert response.status_code == 422
    response = client.post("/api/users", json={**ONBOARDING, "name": "Kim", "age": 9})
    assert response.status_code == 422


def test_onboarding_stores_body_weight_and_filters_priorities(client):
    user_id = create_user(client, "Kim", priority_muscles=["chest", "cardio", "unknown"])
    me = client.get("/api/me", headers=as_user(user_id)).json()
    assert me["priority_muscles"] == ["chest"]
    assert me["level"] == "intermediate"
    assert me["bmi"] == 24.7
    body = client.get("/api/body", headers=as_user(user_id)).json()
    assert body["entries"][0]["weight_kg"] == 80


def test_requests_without_a_known_user_are_rejected(client):
    assert client.get("/api/programs").status_code == 401
    assert client.get("/api/programs", headers=as_user(999)).status_code == 401


def test_update_profile_and_name_conflicts(client):
    alex = create_user(client, "Alex")
    create_user(client, "Sam")
    updated = client.put("/api/me", json={"name": " Alex  Smith ", "color": "#123456"}, headers=as_user(alex)).json()
    assert updated["name"] == "Alex Smith"
    assert updated["color"] == "#123456"
    assert client.put("/api/me", json={"name": "sam"}, headers=as_user(alex)).status_code == 409
    assert client.put("/api/me", json={"color": "red"}, headers=as_user(alex)).status_code == 422


def test_deleting_the_main_account_hands_admin_to_the_next_user(client):
    alex = create_user(client, "Alex")
    sam = create_user(client, "Sam")
    assert client.delete("/api/users/" + str(alex)).status_code == 200
    users = client.get("/api/users").json()
    assert [user["id"] for user in users] == [sam]
    assert users[0]["is_superuser"] == 1
    assert client.get("/api/me", headers=as_user(alex)).status_code == 401


def test_rebuild_is_blocked_while_a_workout_is_active(client):
    user_id = create_user(client)
    client.post("/api/sessions", json={"day": "2026-01-05", "program_id": None}, headers=as_user(user_id))
    response = client.post("/api/me/rebuild", json={"reasons": ["boring"]}, headers=as_user(user_id))
    assert response.status_code == 409


def test_rebuild_state_lists_reasons_and_restore_needs_history(client):
    user_id = create_user(client)
    state = client.get("/api/me/rebuild", headers=as_user(user_id)).json()
    assert state["can_restore"] is False
    assert {reason["key"] for reason in state["reasons"]} >= {"pain", "boring"}
    assert client.post("/api/me/rebuild/restore", headers=as_user(user_id)).status_code == 404


def test_coach_persona_can_be_switched(client):
    user_id = create_user(client)
    assert client.get("/api/coach/persona", headers=as_user(user_id)).json()["coach"] == "max"
    switched = client.put("/api/coach/persona", json={"coach": "lena"}, headers=as_user(user_id)).json()
    assert switched["coach"] == "lena"
    assert client.put("/api/coach/persona", json={"coach": "zed"}, headers=as_user(user_id)).status_code == 422

import db
from conftest import as_user, create_program, create_user, exercises_by_name

EXERCISE = {
    "name": "Banded Pull Apart", "measure": "reps", "track_weight": False, "primary_muscle": "rear_delts", "secondary_muscles": ["upper_back", "rear_delts", "nope"],
    "pattern": "rear_delt", "equipment": ["resistance_band", "missing_key"], "difficulty": 1, "cues": " Squeeze ",
}


def test_meta_lists_muscles_and_labels(client):
    data = client.get("/api/meta").json()
    assert "chest" in data["muscles"]
    assert data["muscle_labels"]["front_delts"] == "Front delts"
    assert data["measures"] == ["reps", "sec", "min", "none"]


def test_create_exercise_cleans_input(client):
    user_id = create_user(client)
    created = client.post("/api/exercises", json=EXERCISE, headers=as_user(user_id)).json()
    assert created["secondary_muscles"] == ["upper_back"]
    assert created["equipment"] == ["resistance_band"]
    assert created["cues"] == "Squeeze"
    listed = exercises_by_name(client, user_id)["Banded Pull Apart"]
    assert listed["available"] is False
    assert client.post("/api/exercises", json={**EXERCISE, "name": "banded pull apart"}, headers=as_user(user_id)).status_code == 409


def test_exercise_validation(client):
    user_id = create_user(client)
    assert client.post("/api/exercises", json={**EXERCISE, "measure": "km"}, headers=as_user(user_id)).status_code == 400
    assert client.post("/api/exercises", json={**EXERCISE, "primary_muscle": "wings"}, headers=as_user(user_id)).status_code == 400
    assert client.post("/api/exercises", json={**EXERCISE, "video": "not a link"}, headers=as_user(user_id)).status_code == 400
    response = client.post("/api/exercises", json={**EXERCISE, "video": "youtu.be/dQw4w9WgXcQ", "video_start": 20, "video_end": 10}, headers=as_user(user_id))
    assert response.status_code == 400


def test_video_link_marks_source_and_survives_updates(client):
    user_id = create_user(client)
    created = client.post("/api/exercises", json={**EXERCISE, "video": "https://youtu.be/dQw4w9WgXcQ", "video_start": 5}, headers=as_user(user_id)).json()
    assert (created["video_id"], created["video_source"], created["video_start"]) == ("dQw4w9WgXcQ", "manual", 5)
    updated = client.put("/api/exercises/" + str(created["id"]), json={**EXERCISE, "name": "Pull Apart", "video": "dQw4w9WgXcQ"}, headers=as_user(user_id)).json()
    assert updated["video_source"] == "manual"
    assert updated["name"] == "Pull Apart"


def test_media_upload_accepts_jpeg_names_and_rejects_bad_files(client):
    user_id = create_user(client)
    created = client.post("/api/exercises", json=EXERCISE, headers=as_user(user_id)).json()
    url = "/api/exercises/" + str(created["id"]) + "/media/"
    uploaded = client.post(url + "muscles", files={"file": ("photo.JPEG", b"\xff\xd8\xff", "application/octet-stream")}, headers=as_user(user_id)).json()
    assert uploaded["media_muscles"].endswith(".jpg")
    assert (db.MEDIA_DIR / uploaded["media_muscles"]).exists()
    assert client.post(url + "loop", files={"file": ("notes.txt", b"hi", "text/plain")}, headers=as_user(user_id)).status_code == 400
    assert client.post(url + "loop", files={"file": ("empty.gif", b"", "image/gif")}, headers=as_user(user_id)).status_code == 400
    assert client.post(url + "other", files={"file": ("a.gif", b"GIF", "image/gif")}, headers=as_user(user_id)).status_code == 400
    replaced = client.post(url + "muscles", files={"file": ("new.png", b"\x89PNG", "image/png")}, headers=as_user(user_id)).json()
    assert not (db.MEDIA_DIR / uploaded["media_muscles"]).exists()
    removed = client.delete(url + "muscles", headers=as_user(user_id)).json()
    assert removed["media_muscles"] is None
    assert not (db.MEDIA_DIR / replaced["media_muscles"]).exists()


def test_deleting_an_exercise_removes_it_from_programs(client):
    user_id = create_user(client)
    created = client.post("/api/exercises", json=EXERCISE, headers=as_user(user_id)).json()
    create_program(client, user_id, [{"exercise_id": created["id"], "sets": 3, "rep_min": 10, "rep_max": 15, "rest_seconds": 60}])
    client.delete("/api/exercises/" + str(created["id"]), headers=as_user(user_id))
    assert client.get("/api/programs", headers=as_user(user_id)).json()[0]["items"] == []


def test_equipment_crud_and_unique_keys(client):
    user_id = create_user(client)
    first = client.post("/api/equipment", json={"name": "Sandbag", "category": "accessory", "weights": [20, 10, 10]}, headers=as_user(user_id)).json()
    second = client.post("/api/equipment", json={"name": "Sandbag"}, headers=as_user(user_id)).json()
    assert first["key"] == "sandbag"
    assert second["key"] == "sandbag_2"
    assert first["weights"] == [10, 20]
    updated = client.put("/api/equipment/sandbag", json={"name": "Big sandbag", "category": "accessory", "available": False, "weights": None},
                         headers=as_user(user_id)).json()
    assert updated["available"] is False
    assert updated["swapped"] == []
    assert client.delete("/api/equipment/sandbag_2", headers=as_user(user_id)).json()["ok"] is True
    assert client.put("/api/equipment/unknown", json={"name": "X"}, headers=as_user(user_id)).status_code == 404


def test_switching_off_used_equipment_waits_for_the_ai(client):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    response = client.put("/api/equipment/bench", json={"name": "Flat bench", "category": "bench", "available": False}, headers=as_user(user_id)).json()
    assert response["swapped"] == []
    assert response["pending"].startswith("Replacements will run as soon as the AI coach is ready")


def test_switching_off_used_equipment_swaps_with_ai(client, fake_ai):
    user_id = create_user(client)
    bench = exercises_by_name(client, user_id)["Barbell Bench Press"]
    program = create_program(client, user_id, [{"exercise_id": bench["id"], "sets": 3, "rep_min": 8, "rep_max": 12, "rest_seconds": 90}])
    response = client.put("/api/equipment/bench", json={"name": "Flat bench", "category": "bench", "available": False}, headers=as_user(user_id)).json()
    assert len(response["swapped"]) == 1
    item = client.get("/api/programs/" + str(program["id"]), headers=as_user(user_id)).json()["items"][0]
    assert item["name"] == response["swapped"][0]
    assert "bench" not in item["equipment"]


def test_equipment_photo_upload(client):
    user_id = create_user(client)
    photo = client.post("/api/equipment/mat/photo", files={"file": ("mat.jpeg", b"\xff\xd8", "image/jpeg")}, headers=as_user(user_id)).json()
    assert photo["photo"].startswith("equipment-mat-")
    assert client.get("/media/" + photo["photo"]).status_code == 200
    assert client.post("/api/equipment/mat/photo", files={"file": ("mat.pdf", b"%PDF", "application/pdf")}, headers=as_user(user_id)).status_code == 400
    assert client.delete("/api/equipment/mat/photo", headers=as_user(user_id)).json()["photo"] is None

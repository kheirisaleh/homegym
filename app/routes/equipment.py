import json
import secrets
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

import db
import engine
from db import now_iso, query_all, query_one, transaction
from deps import MAX_MEDIA_BYTES, MEDIA_TYPES, remove_media_file
from schemas import EquipmentIn

router = APIRouter()


@router.get("/api/equipment")
def list_equipment():
    rows = sorted(db.equipment_map().values(), key=lambda row: (not row["available"], row["category"], row["name"]))
    usage = {}
    for exercise in engine.library_exercises():
        for key in exercise["equipment"]:
            usage[key] = usage.get(key, 0) + 1
    for row in rows:
        row["exercise_count"] = usage.get(row["key"], 0)
    return rows


def equipment_key(name):
    base = "".join(char if char.isalnum() else "_" for char in name.lower()).strip("_")[:30] or "item"
    key = base
    counter = 2
    while query_one("SELECT 1 FROM equipment WHERE key = ?", (key,)):
        key = base + "_" + str(counter)
        counter += 1
    return key


def clean_weights(weights):
    if not weights:
        return None
    values = sorted({round(float(value), 2) for value in weights if 0 < float(value) < 1000})
    return json.dumps(values) if values else None


@router.post("/api/equipment")
def create_equipment(body: EquipmentIn):
    key = equipment_key(body.key or body.name)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO equipment (key, name, category, available, weights, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (key, body.name.strip(), body.category, 1 if body.available else 0, clean_weights(body.weights), body.notes.strip(), now_iso()),
        )
    return db.equipment_map()[key]


@router.put("/api/equipment/{key}")
def update_equipment(key: str, body: EquipmentIn):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    with transaction() as conn:
        conn.execute(
            "UPDATE equipment SET name = ?, category = ?, available = ?, weights = ?, notes = ? WHERE key = ?",
            (body.name.strip(), body.category, 1 if body.available else 0, clean_weights(body.weights), body.notes.strip(), key),
        )
    result = db.equipment_map()[key]
    result["swapped"], result["pending"] = replace_unavailable()
    return result


def replace_unavailable():
    swapped = []
    pending = None
    for user in query_all("SELECT id FROM users WHERE status = 'ready'"):
        with db.as_user(user["id"]):
            try:
                swapped.extend(engine.fix_unavailable_items())
            except engine.AIUnavailable as error:
                pending = "Replacements will run as soon as the AI coach is ready (" + str(error) + ")."
    return swapped, pending


@router.delete("/api/equipment/{key}")
def delete_equipment(key: str):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    with transaction() as conn:
        conn.execute("DELETE FROM equipment WHERE key = ?", (key,))
    remove_media_file(existing.get("photo"))
    swapped, pending = replace_unavailable()
    return {"ok": True, "swapped": swapped, "pending": pending}


@router.post("/api/equipment/{key}/photo")
async def upload_equipment_photo(key: str, file: UploadFile = File(...)):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    extension = MEDIA_TYPES.get((file.content_type or "").lower())
    if not extension or extension not in (".png", ".jpg", ".webp", ".gif", ".svg"):
        suffix = Path(file.filename or "").suffix.lower().replace(".jpeg", ".jpg")
        extension = suffix if suffix in (".png", ".jpg", ".webp", ".gif", ".svg", ".heic") else None
    if not extension:
        raise HTTPException(400, "Allowed: PNG, JPG, WEBP, GIF, SVG")
    content = await file.read(MAX_MEDIA_BYTES + 1)
    if len(content) > MAX_MEDIA_BYTES:
        raise HTTPException(413, "File is larger than 60 MB")
    if not content:
        raise HTTPException(400, "File is empty")
    name = "equipment-" + key + "-" + secrets.token_hex(4) + extension
    (db.MEDIA_DIR / name).write_bytes(content)
    with transaction() as conn:
        conn.execute("UPDATE equipment SET photo = ? WHERE key = ?", (name, key))
    remove_media_file(existing["photo"])
    return db.equipment_map()[key]


@router.delete("/api/equipment/{key}/photo")
def delete_equipment_photo(key: str):
    existing = query_one("SELECT * FROM equipment WHERE key = ?", (key,))
    if not existing:
        raise HTTPException(404, "Equipment not found")
    with transaction() as conn:
        conn.execute("UPDATE equipment SET photo = NULL WHERE key = ?", (key,))
    remove_media_file(existing["photo"])
    return db.equipment_map()[key]

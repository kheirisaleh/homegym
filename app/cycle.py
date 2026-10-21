import hashlib
from html import escape as html_escape
import hmac
import json
import math
import os
import secrets
import statistics
import time
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

import ai
import db
import engine

router = APIRouter()

LEVELS = ["none", "light", "moderate", "rest"]
TOKEN_SECONDS = 30 * 60
SYMPTOMS = ["cramps", "back_pain", "headache", "bloating"]
TRACKED = ["energy", "cramps", "back_pain", "headache", "bloating", "flow", "sleep", "mood"]
SOFT_CORE_PATTERNS = {"core_flexion", "hip_flexion", "rotation"}
SAFE_CORE_PATTERNS = ["anti_lateral", "anti_extension"]
PHASES = [(1, 3, "Days 1 to 3"), (4, 7, "Days 4 to 7"), (8, 14, "Days 8 to 14"), (15, 21, "Days 15 to 21"), (22, 999, "Day 22 on")]

SCHEMA = """
CREATE TABLE IF NOT EXISTS cycle_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_day TEXT NOT NULL,
    end_day TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, start_day)
);
CREATE TABLE IF NOT EXISTS cycle_days (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    energy INTEGER,
    cramps INTEGER,
    back_pain INTEGER,
    headache INTEGER,
    bloating INTEGER,
    flow INTEGER,
    sleep INTEGER,
    mood INTEGER,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS cycle_adjustments (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    program_id INTEGER NOT NULL,
    signature TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day, program_id)
);
"""


def init_schema():
    with db.transaction() as conn:
        conn.executescript(SCHEMA)


def secret():
    path = db.DATA_DIR / "health_secret"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        os.chmod(path, 0o600)
    return path.read_text().strip().encode()


def to_date(value):
    return date.fromisoformat(str(value)[:10])


def valid_day(value):
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid date")


def current_user():
    return db.query_one("SELECT id, sex FROM users WHERE id = ?", (db.uid(),))


def require_eligible():
    user = current_user()
    if not user or user["sex"] != "female":
        raise HTTPException(403, "Not available for this profile")
    return user


def active_period(day=None):
    day = day or date.today().isoformat()
    return db.query_one(
        "SELECT * FROM cycle_periods WHERE user_id = ? AND start_day <= ? AND end_day IS NULL ORDER BY start_day DESC LIMIT 1",
        (db.uid(), day),
    )


def checkin_for(day):
    row = db.query_one("SELECT * FROM cycle_days WHERE user_id = ? AND day = ?", (db.uid(), day))
    if not row:
        return None
    row.pop("user_id", None)
    return row


def signature_of(checkin):
    if not checkin:
        return "none"
    parts = [str(checkin.get(key)) for key in ("energy", "cramps", "back_pain", "headache", "bloating", "flow")]
    return "|".join(parts)


def level_for(checkin):
    if not checkin:
        return "light"
    energy = checkin.get("energy") or 3
    cramps = checkin.get("cramps") or 0
    back = checkin.get("back_pain") or 0
    headache = checkin.get("headache") or 0
    bloating = checkin.get("bloating") or 0
    flow = checkin.get("flow") or 0
    if cramps >= 3 or (energy <= 1 and (cramps >= 2 or flow >= 3)):
        return "rest"
    if energy <= 2 or cramps >= 2 or back >= 2 or headache >= 2:
        return "moderate"
    if energy == 3 or bloating >= 2 or max(cramps, back, headache, bloating) >= 1 or flow >= 3:
        return "light"
    return "none"


def advice_for(checkin):
    notes = []
    if not checkin:
        return notes
    if (checkin.get("cramps") or 0) >= 3:
        notes.append("Strong cramps today. Rest is the right call. If the pain is much worse than usual for you, please talk to a doctor.")
    if (checkin.get("flow") or 0) >= 3:
        notes.append("Very heavy flow: keep it easy and drink enough. If this happens often, it is worth mentioning to a doctor.")
    if (checkin.get("headache") or 0) >= 2:
        notes.append("Headache: longer rests and no breath holding on heavy sets.")
    return notes


def exercise_info(exercise_ids):
    if not exercise_ids:
        return {}
    marks = ",".join("?" for _ in exercise_ids)
    rows = db.query_all("SELECT * FROM exercises WHERE id IN (" + marks + ")", tuple(exercise_ids))
    return {row["id"]: db.exercise_row(row) for row in rows}


def available_library():
    equipment = db.equipment_map()
    return [exercise for exercise in engine.library_exercises() if engine.available_exercise(exercise, equipment)]


def step_down(weight, factor, load_key, equipment):
    if not weight:
        return weight
    target = weight * factor
    steps = equipment.get(load_key, {}).get("weights") if load_key else None
    if steps:
        lower = [step for step in steps if step <= target + 1e-6]
        return max(lower) if lower else min(steps)
    return math.floor(target * 2) / 2


def recovery_items(library):
    by_name = {exercise["name"]: exercise for exercise in library}
    items = []
    walk = by_name.get("Walking") or by_name.get("Treadmill Walking") or next((exercise for exercise in library if exercise.get("pattern") == "cardio_steady" and exercise.get("difficulty") == 1), None)
    stretch = by_name.get("Stretching") or next((exercise for exercise in library if exercise.get("primary_muscle") == "mobility"), None)
    if walk:
        items.append(new_item(walk, sets=1, rep_min=20, rep_max=30, cue="Easy pace, you can talk the whole time."))
    if stretch:
        items.append(new_item(stretch, sets=1, rep_min=10, rep_max=15, cue="Gentle hips, lower back and hamstrings. Child pose and cat cow feel good on these days."))
    return items


def new_item(exercise, sets, rep_min, rep_max, cue="", rest=0, replaces=None):
    return {
        "id": None,
        "exercise_id": exercise["id"],
        "name": exercise["name"],
        "measure": exercise["measure"],
        "track_weight": bool(exercise["track_weight"]),
        "primary_muscle": exercise.get("primary_muscle"),
        "pattern": exercise.get("pattern"),
        "sets": sets,
        "rep_min": rep_min,
        "rep_max": rep_max,
        "target": "",
        "target_weight": None,
        "rest_seconds": rest,
        "cue": cue,
        "change": "swapped" if replaces else "added",
        "replaces": replaces,
    }


def safe_core_swap(item, library, used):
    options = [exercise for exercise in library if exercise.get("pattern") in SAFE_CORE_PATTERNS and exercise["id"] not in used]
    options.sort(key=lambda exercise: (exercise.get("difficulty") or 9, 0 if exercise["measure"] == "sec" else 1))
    if not options:
        return None
    pick = options[0]
    if pick["measure"] == "sec":
        return new_item(pick, sets=2, rep_min=20, rep_max=30, rest=60, replaces=item["name"], cue="Breathe normally. Stop if the belly cramps.")
    return new_item(pick, sets=2, rep_min=8, rep_max=10, rest=60, replaces=item["name"], cue="Slow and controlled. Stop if the belly cramps.")


def steady_swap(item, library, used):
    options = [exercise for exercise in library if exercise.get("pattern") == "cardio_steady" and exercise["id"] not in used]
    options.sort(key=lambda exercise: exercise.get("difficulty") or 9)
    if not options:
        return None
    return new_item(options[0], sets=1, rep_min=15, rep_max=25, replaces=item["name"], cue="Steady and easy instead of intervals today.")


def rule_plan(program, checkin):
    level = level_for(checkin)
    equipment = db.equipment_map()
    library = available_library()
    info = exercise_info([item["exercise_id"] for item in program["items"]])
    cramps = (checkin or {}).get("cramps") or 0
    back = (checkin or {}).get("back_pain") or 0
    headache = (checkin or {}).get("headache") or 0
    result = {"level": level, "source": "rules", "items": [], "advice": advice_for(checkin), "note": ""}
    if level == "rest":
        result["items"] = recovery_items(library)
        result["note"] = "Today is a recovery day: an easy walk and gentle stretching. Your normal program comes back when you feel better."
        return result
    used = {item["exercise_id"] for item in program["items"]}
    for original in program["items"]:
        item = dict(original)
        meta = info.get(item["exercise_id"], {})
        item["pattern"] = meta.get("pattern")
        item["load_equipment"] = meta.get("load_equipment")
        item["change"] = None
        item["replaces"] = None
        measure = item["measure"]
        if level == "none":
            result["items"].append(item)
            continue
        if level == "moderate" and item["pattern"] == "cardio_interval":
            swap = steady_swap(item, library, used)
            if swap:
                used.add(swap["exercise_id"])
                result["items"].append(swap)
            continue
        if cramps >= 2 and item["pattern"] in SOFT_CORE_PATTERNS:
            swap = safe_core_swap(item, library, used)
            if swap:
                used.add(swap["exercise_id"])
                result["items"].append(swap)
            continue
        if measure in ("min", "none"):
            if level == "moderate" and item.get("rep_max"):
                item["rep_min"] = max(5, round((item.get("rep_min") or item["rep_max"]) * 0.75))
                item["rep_max"] = max(item["rep_min"], round(item["rep_max"] * 0.75))
                item["change"] = "lighter"
            result["items"].append(item)
            continue
        sets = item["sets"]
        if level == "light":
            item["sets"] = sets - 1 if sets >= 3 else sets
            item["rest_seconds"] = (item["rest_seconds"] or 60) + 15
            item["cue"] = "Stop each set with 2 to 3 reps left in the tank."
        else:
            item["sets"] = max(1, round(sets * 0.6))
            factor = 0.9
            if back >= 2 and item["pattern"] == "hinge":
                factor = 0.8
                item["sets"] = min(item["sets"], 2)
            if item.get("target_weight"):
                item["target_weight"] = step_down(item["target_weight"], factor, item["load_equipment"], equipment)
            item["rest_seconds"] = (item["rest_seconds"] or 60) + (60 if headache >= 2 else 30)
            item["cue"] = "Lighter today. Smooth reps, 3 or more reps left in the tank."
        if item["sets"] != sets or item.get("target_weight") != original.get("target_weight"):
            item["change"] = "lighter"
        result["items"].append(item)
    if level == "light":
        result["note"] = "A slightly lighter version of your normal workout: one set less on the big lifts and a bit more rest."
    elif level == "moderate":
        result["note"] = "A clearly lighter version: fewer sets, about 10 percent less weight and longer rests. Movements that press on the belly are swapped when cramps are strong."
    else:
        result["note"] = "You feel good, so your normal workout stays as it is. Listen to your body and stop a set early if something feels off."
    return result


ADJUST_SCHEMA = {
    "type": "object",
    "properties": {
        "note": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "exercise_id": {"type": "integer"},
                    "sets": {"type": "integer"},
                    "rep_min": {"type": "integer"},
                    "rep_max": {"type": "integer"},
                    "weight_factor": {"type": "number"},
                    "rest_seconds": {"type": "integer"},
                    "cue": {"type": "string"},
                },
                "required": ["exercise_id", "sets", "rep_min", "rep_max", "weight_factor", "rest_seconds", "cue"],
            },
        },
    },
    "required": ["note", "items"],
}

AI_GUIDE = (
    "Context: the person is on her period today and told you how she feels. "
    "Research (umbrella review 2023 and later reviews) shows the cycle phase itself does not reliably change strength or training results, "
    "so you adjust only to today's symptoms and energy, never to the phase alone. "
    "You get the normal workout and a safe rule based version. Improve the rule based version: better exercise order, smarter swaps from the allowed list, "
    "fitting rep ranges and short, warm, practical cues. You must never make it harder than the rule based version: "
    "no more sets per exercise than the rule version gives that exercise or its replaced original, total sets at most the rule total, "
    "weight_factor between 0.6 and the given maximum, rest between 30 and 300 seconds. "
    "Do not use any pattern from the forbidden list. Do not diagnose anything and do not mention hormones or cycle phases. "
    "The note is 2 or 3 sentences for her."
)


def ai_plan(program, checkin, rule):
    if rule["level"] in ("none", "rest") or not ai.available():
        return None
    library = available_library()
    forbidden = set()
    cramps = (checkin or {}).get("cramps") or 0
    if cramps >= 2:
        forbidden |= SOFT_CORE_PATTERNS
    if rule["level"] == "moderate":
        forbidden.add("cardio_interval")
    original_ids = {item["exercise_id"] for item in program["items"]}
    rule_ids = {item["exercise_id"] for item in rule["items"]}
    muscles = {item.get("primary_muscle") for item in program["items"]}
    candidates = [exercise for exercise in library if exercise["id"] not in original_ids and exercise.get("pattern") not in forbidden
                  and (exercise.get("primary_muscle") in muscles or exercise.get("pattern") in ("cardio_steady", "mobility") or exercise.get("pattern") in SAFE_CORE_PATTERNS)
                  and (exercise.get("difficulty") or 1) <= 2][:40]
    allowed = {exercise["id"]: exercise for exercise in candidates}
    info = exercise_info(list(original_ids | rule_ids))
    for exercise_id in original_ids | rule_ids:
        if exercise_id in info and info[exercise_id].get("pattern") not in forbidden:
            allowed[exercise_id] = info[exercise_id]
    max_factor = 1.0 if rule["level"] == "light" else 0.9
    rule_total = sum(item["sets"] for item in rule["items"] if item["measure"] not in ("min", "none"))
    rule_sets = {item["exercise_id"]: item["sets"] for item in rule["items"]}
    original_sets = {item["exercise_id"]: item["sets"] for item in program["items"]}
    lines = [
        "Today: energy " + str((checkin or {}).get("energy")) + " of 5, cramps " + str(cramps) + " of 3, back pain " + str((checkin or {}).get("back_pain") or 0) +
        " of 3, headache " + str((checkin or {}).get("headache") or 0) + " of 3, bloating " + str((checkin or {}).get("bloating") or 0) + " of 3.",
        "Rule level: " + rule["level"] + ". Maximum weight_factor: " + str(max_factor) + ". Rule total working sets: " + str(rule_total) + ".",
        "Forbidden patterns: " + (", ".join(sorted(forbidden)) or "none"),
        "Normal workout:",
    ]
    for item in program["items"]:
        meta = info.get(item["exercise_id"], {})
        lines.append("  id=" + str(item["exercise_id"]) + " | " + item["name"] + " | " + str(item["sets"]) + " sets " + str(item.get("rep_min")) + " to " + str(item.get("rep_max")) +
                     " " + item["measure"] + " | pattern " + str(meta.get("pattern")) + " | rest " + str(item["rest_seconds"]))
    lines.append("Rule based version:")
    for item in rule["items"]:
        lines.append("  id=" + str(item["exercise_id"]) + " | " + item["name"] + " | " + str(item["sets"]) + " sets " + str(item.get("rep_min")) + " to " + str(item.get("rep_max")) +
                     " | rest " + str(item["rest_seconds"]))
    lines.append("Allowed exercise ids:")
    for exercise in allowed.values():
        lines.append("  id=" + str(exercise["id"]) + " | " + exercise["name"] + " | " + exercise["measure"] + " | target " + str(exercise.get("primary_muscle")) +
                     " | pattern " + str(exercise.get("pattern")) + " | difficulty " + str(exercise.get("difficulty")))
    try:
        raw = ai.chat_json("\n".join(lines), ADJUST_SCHEMA, timeout=45, system=ai.expert_system_prompt(AI_GUIDE), temperature=0.2)
    except Exception as error:
        return {"error": str(error)}
    return validate_ai(raw, program, rule, allowed, forbidden, max_factor, rule_total, rule_sets, original_sets)


def validate_ai(raw, program, rule, allowed, forbidden, max_factor, rule_total, rule_sets, original_sets):
    items = raw.get("items") or []
    if not items or len(items) > len(program["items"]) + 1:
        return {"error": "AI returned an unusable number of exercises"}
    equipment = db.equipment_map()
    originals = {item["exercise_id"]: item for item in program["items"]}
    cap = max(rule_sets.values() or [1])
    result_items = []
    seen = set()
    total = 0
    for entry in items:
        exercise = allowed.get(entry.get("exercise_id"))
        if not exercise or exercise["id"] in seen:
            return {"error": "AI used an exercise that is not allowed"}
        if exercise.get("pattern") in forbidden:
            return {"error": "AI used a forbidden movement"}
        seen.add(exercise["id"])
        limit = rule_sets.get(exercise["id"]) or min(original_sets.get(exercise["id"], cap), cap)
        sets = int(entry.get("sets") or 0)
        if sets < 1 or sets > limit:
            return {"error": "AI gave too many sets"}
        factor = float(entry.get("weight_factor") or 0)
        if factor < 0.6 or factor > max_factor + 1e-6:
            return {"error": "AI weight factor out of range"}
        rest = int(entry.get("rest_seconds") or 0)
        if rest < 30 or rest > 300:
            rest = max(30, min(300, rest))
        rep_min, rep_max = int(entry.get("rep_min") or 0), int(entry.get("rep_max") or 0)
        if rep_min < 1 or rep_max < rep_min or rep_max > 60:
            return {"error": "AI rep range out of range"}
        source = originals.get(exercise["id"])
        if source:
            item = dict(source)
            item["sets"] = sets
            item["rep_min"], item["rep_max"] = rep_min, rep_max
            item["rest_seconds"] = rest
            if item.get("target_weight"):
                item["target_weight"] = step_down(item["target_weight"], factor, exercise.get("load_equipment"), equipment)
            item["change"] = "lighter" if (sets < source["sets"] or factor < 0.999) else None
            item["replaces"] = None
            item["pattern"] = exercise.get("pattern")
        else:
            item = new_item(exercise, sets, rep_min, rep_max, rest=rest)
            replaced = next((rule_item.get("replaces") for rule_item in rule["items"] if rule_item["exercise_id"] == exercise["id"]), None)
            item["change"] = "swapped" if replaced else "added"
            item["replaces"] = replaced
        item["cue"] = (entry.get("cue") or "").strip()[:200]
        if item["measure"] not in ("min", "none"):
            total += sets
        result_items.append(item)
    if total > rule_total:
        return {"error": "AI plan has more total sets than allowed"}
    note = (raw.get("note") or "").strip()[:500]
    return {"level": rule["level"], "source": "ai", "items": result_items, "advice": rule["advice"], "note": note or rule["note"]}


def compute_plan(program, day, use_ai=True):
    checkin = checkin_for(day)
    signature = signature_of(checkin)
    cached = db.query_one("SELECT * FROM cycle_adjustments WHERE user_id = ? AND day = ? AND program_id = ?", (db.uid(), day, program["id"]))
    if cached and cached["signature"] == signature:
        plan = json.loads(cached["payload"])
        if plan.get("source") == "ai" or not use_ai:
            return plan
    rule = rule_plan(program, checkin)
    plan = rule
    if use_ai:
        refined = ai_plan(program, checkin, rule)
        if refined and not refined.get("error"):
            plan = refined
        elif refined:
            plan = dict(rule, ai_error=refined["error"])
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO cycle_adjustments (user_id, day, program_id, signature, payload, created_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id, day, program_id) DO UPDATE SET signature = excluded.signature, payload = excluded.payload, created_at = excluded.created_at",
            (db.uid(), day, program["id"], signature, json.dumps(plan), db.now_iso()),
        )
    return plan


def apply_to_program(program, day):
    user = current_user()
    if not program or not user or user["sex"] != "female" or not active_period(day):
        return program, False
    plan = compute_plan(program, day, use_ai=False)
    if plan["level"] == "none":
        return program, False
    adjusted = dict(program)
    adjusted["items"] = plan["items"]
    adjusted["name"] = program["name"] + " (light)"
    return adjusted, True


def predict(periods, today=None):
    today = today or date.today()
    starts = [to_date(period["start_day"]) for period in periods]
    lengths = [(starts[index + 1] - starts[index]).days for index in range(len(starts) - 1)]
    usable = [length for length in lengths if 10 <= length <= 90][-6:]
    if not starts:
        return None
    if len(usable) >= 2:
        mean = statistics.mean(usable)
        spread = max(2, round(statistics.pstdev(usable) * 1.5))
        confidence = "good" if len(usable) >= 4 and statistics.pstdev(usable) <= 3 else "fair"
    elif len(usable) == 1:
        mean, spread, confidence = usable[0], 4, "low"
    else:
        mean, spread, confidence = 28, 5, "low"
    last = starts[-1]
    next_start = last + timedelta(days=round(mean))
    return {
        "next_start": next_start.isoformat(),
        "window_start": (next_start - timedelta(days=spread)).isoformat(),
        "window_end": (next_start + timedelta(days=spread)).isoformat(),
        "average_length": round(mean, 1),
        "confidence": confidence,
        "based_on": len(usable),
        "days_until": (next_start - today).days,
    }


def all_periods():
    return db.query_all("SELECT * FROM cycle_periods WHERE user_id = ? ORDER BY start_day", (db.uid(),))


def cycle_day_of(day, starts):
    current = None
    for start in starts:
        if start <= day:
            current = start
        else:
            break
    if current is None:
        return None
    return (day - current).days + 1


def phase_label(cycle_day):
    for low, high, label in PHASES:
        if low <= cycle_day <= high:
            return label
    return None


def session_strength():
    sessions = db.query_all("SELECT id, day, cycle_adjusted, deload FROM sessions WHERE user_id = ? AND status = 'done' ORDER BY day", (db.uid(),))
    exposures = {}
    rows = db.query_all(
        "SELECT DISTINCT se.exercise_id FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE s.user_id = ? AND se.exercise_id IS NOT NULL AND se.measure = 'reps'",
        (db.uid(),),
    )
    for row in rows:
        history = [entry for entry in engine.exercise_exposures(row["exercise_id"]) if entry["metric"]]
        if len(history) < 3:
            continue
        typical = statistics.median(entry["metric"] for entry in history)
        if typical <= 0:
            continue
        for entry in history:
            exposures.setdefault(entry["session_id"], []).append(entry["metric"] / typical)
    efforts = {row["session_id"]: row["effort"] for row in db.query_all(
        "SELECT se.session_id, AVG(ss.effort) AS effort FROM session_sets ss JOIN session_exercises se ON se.id = ss.session_exercise_id "
        "JOIN sessions s ON s.id = se.session_id WHERE s.user_id = ? AND ss.effort IS NOT NULL GROUP BY se.session_id",
        (db.uid(),),
    )}
    result = []
    for session in sessions:
        ratios = exposures.get(session["id"])
        result.append({
            "day": session["day"],
            "strength": statistics.mean(ratios) if ratios else None,
            "effort": efforts.get(session["id"]),
            "adjusted": bool(session["cycle_adjusted"]),
        })
    return result


def health_stats():
    today = date.today()
    periods = all_periods()
    starts = [to_date(period["start_day"]) for period in periods]
    cycles = []
    for index, period in enumerate(periods):
        start = starts[index]
        end = to_date(period["end_day"]) if period["end_day"] else None
        cycles.append({
            "id": period["id"],
            "start": period["start_day"],
            "end": period["end_day"],
            "period_length": (end - start).days + 1 if end else None,
            "cycle_length": (starts[index + 1] - start).days if index + 1 < len(starts) else None,
            "ongoing": end is None,
        })
    lengths = [cycle["cycle_length"] for cycle in cycles if cycle["cycle_length"]]
    recent = lengths[-6:]
    bleed = [cycle["period_length"] for cycle in cycles if cycle["period_length"]]
    days = db.query_all("SELECT * FROM cycle_days WHERE user_id = ? ORDER BY day", (db.uid(),))
    by_day = {}
    for row in days:
        cycle_day = cycle_day_of(to_date(row["day"]), starts)
        if not cycle_day or cycle_day > 40:
            continue
        bucket = by_day.setdefault(cycle_day, {key: [] for key in TRACKED})
        for key in TRACKED:
            if row.get(key) is not None:
                bucket[key].append(row[key])
    symptom_map = [
        {"cycle_day": cycle_day, **{key: round(statistics.mean(values), 2) if values else None for key, values in by_day[cycle_day].items()}}
        for cycle_day in sorted(by_day)
    ]
    phases = {label: {"label": label, "strength": [], "effort": [], "energy": [], "sessions": 0} for _, _, label in PHASES}
    for session in session_strength():
        cycle_day = cycle_day_of(to_date(session["day"]), starts)
        if not cycle_day:
            continue
        label = phase_label(cycle_day)
        if not label:
            continue
        phases[label]["sessions"] += 1
        if session["strength"] is not None and not session["adjusted"]:
            phases[label]["strength"].append(session["strength"])
        if session["effort"] is not None:
            phases[label]["effort"].append(session["effort"])
    for row in days:
        cycle_day = cycle_day_of(to_date(row["day"]), starts)
        label = phase_label(cycle_day) if cycle_day else None
        if label and row.get("energy") is not None:
            phases[label]["energy"].append(row["energy"])
    phase_rows = []
    for _, _, label in PHASES:
        entry = phases[label]
        phase_rows.append({
            "label": label,
            "sessions": entry["sessions"],
            "strength": round(statistics.mean(entry["strength"]) * 100, 1) if len(entry["strength"]) >= 2 else None,
            "effort": round(statistics.mean(entry["effort"]), 1) if entry["effort"] else None,
            "energy": round(statistics.mean(entry["energy"]), 1) if entry["energy"] else None,
        })
    prediction = predict(periods, today)
    active = active_period(today.isoformat())
    summary = {
        "cycles_tracked": len(lengths),
        "average_cycle": round(statistics.mean(recent), 1) if recent else None,
        "shortest": min(recent) if recent else None,
        "longest": max(recent) if recent else None,
        "average_period": round(statistics.mean(bleed[-6:]), 1) if bleed else None,
        "regularity": regularity(recent),
        "average_sleep": average_of(days[-60:], "sleep"),
        "average_mood": average_of(days[-60:], "mood"),
    }
    return {
        "summary": summary,
        "cycles": cycles[::-1],
        "symptom_map": symptom_map,
        "phases": phase_rows,
        "prediction": prediction,
        "active": active,
        "flags": flags_for(cycles, recent, bleed, prediction, active, days, today),
        "lengths": [{"start": cycle["start"], "length": cycle["cycle_length"]} for cycle in cycles if cycle["cycle_length"]],
    }


def average_of(rows, key):
    values = [row[key] for row in rows if row.get(key) is not None]
    return round(statistics.mean(values), 1) if values else None


def regularity(recent):
    if len(recent) < 3:
        return "not enough data yet"
    spread = max(recent) - min(recent)
    if spread <= 7:
        return "regular"
    if spread < 20:
        return "somewhat variable"
    return "irregular"


def flags_for(cycles, recent, bleed, prediction, active, days, today):
    flags = []
    outside = [length for length in recent if length < 21 or length > 35]
    if len(outside) >= 2:
        flags.append("Several recent cycles were shorter than 21 or longer than 35 days. That is often harmless, but it is worth mentioning to a doctor.")
    if len(recent) >= 3 and max(recent) - min(recent) >= 20:
        flags.append("Your shortest and longest recent cycles differ by 20 days or more. A doctor can check what is behind that.")
    long_periods = [length for length in bleed[-3:] if length > 7]
    if len(long_periods) >= 2:
        flags.append("Your period lasted longer than 7 days more than once. It is a good idea to talk to a doctor about this.")
    if active and (today - to_date(active["start_day"])).days + 1 > 8:
        flags.append("Your current period has lasted more than 7 days. If it is still going, please consider seeing a doctor. If it already ended, switch period mode off.")
    if prediction and not active and prediction["based_on"] >= 3 and today > to_date(prediction["window_end"]) + timedelta(days=7):
        flags.append("Your period is later than usual. Stress, travel and illness can shift it. If it stays away, talking to a doctor can help.")
    starts = [to_date(cycle["start"]) for cycle in cycles[::-1]]
    strong = 0
    for start in starts[-3:]:
        window = [row for row in days if start <= to_date(row["day"]) <= start + timedelta(days=7)]
        if any((row.get("cramps") or 0) >= 3 for row in window):
            strong += 1
    if strong >= 2:
        flags.append("You noted strong cramps in several recent periods. Painful periods are common, but a doctor can help if they get in the way of your life.")
    return flags


def hash_pin(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 200000).hex()


def pin_record():
    raw = db.get_user_setting("health_pin", "")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def check_pin(pin):
    record = pin_record()
    if not record:
        return False
    return hmac.compare_digest(record["hash"], hash_pin(pin, bytes.fromhex(record["salt"])))


def make_token(user_id):
    record = pin_record() or {"hash": ""}
    expires = int(time.time()) + TOKEN_SECONDS
    message = (str(user_id) + "|" + str(expires) + "|" + record["hash"]).encode()
    return str(user_id) + "." + str(expires) + "." + hmac.new(secret(), message, hashlib.sha256).hexdigest()


def require_token(token):
    record = pin_record()
    if not record or not token:
        raise HTTPException(423, "Health data is locked")
    try:
        user_id, expires, mac = token.split(".")
        user_id, expires = int(user_id), int(expires)
    except ValueError:
        raise HTTPException(423, "Health data is locked")
    if user_id != db.uid() or expires < time.time():
        raise HTTPException(423, "Health data is locked")
    message = (str(user_id) + "|" + str(expires) + "|" + record["hash"]).encode()
    if not hmac.compare_digest(mac, hmac.new(secret(), message, hashlib.sha256).hexdigest()):
        raise HTTPException(423, "Health data is locked")


_attempts = {}


def throttle():
    now = time.time()
    entries = [stamp for stamp in _attempts.get(db.uid(), []) if now - stamp < 300]
    if len(entries) >= 5:
        raise HTTPException(429, "Too many tries. Wait a few minutes.")
    entries.append(now)
    _attempts[db.uid()] = entries


class CheckinIn(BaseModel):
    day: str
    energy: int = Field(ge=1, le=5)
    cramps: int = Field(default=0, ge=0, le=3)
    back_pain: int = Field(default=0, ge=0, le=3)
    headache: int = Field(default=0, ge=0, le=3)
    bloating: int = Field(default=0, ge=0, le=3)
    flow: int = Field(default=0, ge=0, le=3)
    sleep: Optional[int] = Field(default=None, ge=1, le=5)
    mood: Optional[int] = Field(default=None, ge=1, le=5)
    note: str = Field(default="", max_length=300)


class StartIn(BaseModel):
    day: str
    checkin: Optional[CheckinIn] = None


class StopIn(BaseModel):
    day: str


class PeriodIn(BaseModel):
    start_day: str
    end_day: Optional[str] = None


class PinIn(BaseModel):
    pin: str = Field(pattern=r"^\d{4,8}$")
    current_pin: Optional[str] = None


class UnlockIn(BaseModel):
    pin: str


def save_checkin(conn, body: CheckinIn):
    day = valid_day(body.day)
    conn.execute(
        """
        INSERT INTO cycle_days (user_id, day, energy, cramps, back_pain, headache, bloating, flow, sleep, mood, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, day) DO UPDATE SET energy = excluded.energy, cramps = excluded.cramps, back_pain = excluded.back_pain,
          headache = excluded.headache, bloating = excluded.bloating, flow = excluded.flow, sleep = excluded.sleep, mood = excluded.mood,
          note = excluded.note, updated_at = excluded.updated_at
        """,
        (db.uid(), day, body.energy, body.cramps, body.back_pain, body.headache, body.bloating, body.flow, body.sleep, body.mood, body.note.strip(), db.now_iso()),
    )


def state_payload(day):
    user = current_user()
    if not user or user["sex"] != "female":
        return {"eligible": False}
    active = active_period(day)
    periods = all_periods()
    prediction = predict(periods, to_date(day))
    checkin = checkin_for(day)
    return {
        "eligible": True,
        "active": bool(active),
        "period_id": active["id"] if active else None,
        "period_day": (to_date(day) - to_date(active["start_day"])).days + 1 if active else None,
        "started": active["start_day"] if active else None,
        "checkin": checkin,
        "level": level_for(checkin) if active else None,
        "prediction": prediction,
        "due_soon": bool(prediction and not active and prediction["based_on"] >= 1 and to_date(prediction["window_start"]) <= to_date(day) <= to_date(prediction["window_end"])),
        "pin_set": pin_record() is not None,
    }


@router.get("/api/cycle/state")
def cycle_state(day: Optional[str] = None):
    return state_payload(valid_day(day) if day else date.today().isoformat())


@router.post("/api/cycle/start")
def cycle_start(body: StartIn):
    require_eligible()
    day = valid_day(body.day)
    with db.transaction() as conn:
        if not active_period(day):
            previous = conn.execute(
                "SELECT * FROM cycle_periods WHERE user_id = ? AND start_day <= ? ORDER BY start_day DESC LIMIT 1", (db.uid(), day)
            ).fetchone()
            if previous and previous["end_day"] and (to_date(day) - to_date(previous["end_day"])).days <= 2:
                conn.execute("UPDATE cycle_periods SET end_day = NULL WHERE id = ?", (previous["id"],))
            else:
                conn.execute("INSERT OR IGNORE INTO cycle_periods (user_id, start_day, created_at) VALUES (?, ?, ?)", (db.uid(), day, db.now_iso()))
                conn.execute("UPDATE cycle_periods SET end_day = NULL WHERE user_id = ? AND start_day = ?", (db.uid(), day))
        if body.checkin:
            save_checkin(conn, body.checkin)
    return state_payload(day)


@router.post("/api/cycle/stop")
def cycle_stop(body: StopIn):
    require_eligible()
    day = valid_day(body.day)
    active = active_period(day)
    if active:
        end = max(to_date(active["start_day"]), to_date(day))
        with db.transaction() as conn:
            conn.execute("UPDATE cycle_periods SET end_day = ? WHERE id = ?", (end.isoformat(), active["id"]))
            conn.execute("DELETE FROM cycle_adjustments WHERE user_id = ? AND day >= ?", (db.uid(), day))
    return state_payload(day)


@router.put("/api/cycle/checkin")
def cycle_checkin(body: CheckinIn):
    require_eligible()
    with db.transaction() as conn:
        save_checkin(conn, body)
    return state_payload(valid_day(body.day))


@router.post("/api/cycle/plan/{program_id}")
def cycle_plan(program_id: int, day: Optional[str] = None, fresh: bool = False):
    require_eligible()
    day = valid_day(day) if day else date.today().isoformat()
    if not active_period(day):
        return {"active": False}
    import main
    program = main.load_program(program_id)
    if not program:
        raise HTTPException(404, "Program not found")
    if fresh:
        with db.transaction() as conn:
            conn.execute("DELETE FROM cycle_adjustments WHERE user_id = ? AND day = ? AND program_id = ?", (db.uid(), day, program_id))
    plan = compute_plan(program, day, use_ai=True)
    return {"active": True, "program_id": program_id, **plan}


@router.post("/api/cycle/pin")
def set_pin(body: PinIn):
    require_eligible()
    if pin_record():
        throttle()
        if not body.current_pin or not check_pin(body.current_pin):
            raise HTTPException(403, "Current PIN is wrong")
    salt = secrets.token_bytes(16)
    with db.transaction() as conn:
        db.set_user_setting(conn, "health_pin", json.dumps({"salt": salt.hex(), "hash": hash_pin(body.pin, salt)}))
    return {"token": make_token(db.uid())}


@router.post("/api/cycle/unlock")
def unlock(body: UnlockIn):
    require_eligible()
    throttle()
    if not check_pin(body.pin):
        raise HTTPException(403, "Wrong PIN")
    _attempts.pop(db.uid(), None)
    return {"token": make_token(db.uid())}


@router.get("/api/cycle/health")
def health(x_health_token: str = Header(default="")):
    require_eligible()
    require_token(x_health_token)
    data = health_stats()
    data["insight"] = db.get_user_json_setting("cycle_insight", None)
    return data


@router.get("/api/cycle/days")
def list_days(x_health_token: str = Header(default=""), limit: int = 90):
    require_eligible()
    require_token(x_health_token)
    return db.query_all("SELECT * FROM cycle_days WHERE user_id = ? ORDER BY day DESC LIMIT ?", (db.uid(), min(limit, 400)))


@router.post("/api/cycle/periods")
def add_period(body: PeriodIn, x_health_token: str = Header(default="")):
    require_eligible()
    require_token(x_health_token)
    start = valid_day(body.start_day)
    end = valid_day(body.end_day) if body.end_day else None
    if end and end < start:
        raise HTTPException(400, "End is before start")
    if to_date(start) > date.today():
        raise HTTPException(400, "Start is in the future")
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO cycle_periods (user_id, start_day, end_day, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, start_day) DO UPDATE SET end_day = excluded.end_day",
            (db.uid(), start, end, db.now_iso()),
        )
    return health_stats()


@router.put("/api/cycle/periods/{period_id}")
def edit_period(period_id: int, body: PeriodIn, x_health_token: str = Header(default="")):
    require_eligible()
    require_token(x_health_token)
    start = valid_day(body.start_day)
    end = valid_day(body.end_day) if body.end_day else None
    if end and end < start:
        raise HTTPException(400, "End is before start")
    with db.transaction() as conn:
        conn.execute("UPDATE cycle_periods SET start_day = ?, end_day = ? WHERE id = ? AND user_id = ?", (start, end, period_id, db.uid()))
    return health_stats()


@router.delete("/api/cycle/periods/{period_id}")
def delete_period(period_id: int, x_health_token: str = Header(default="")):
    require_eligible()
    require_token(x_health_token)
    with db.transaction() as conn:
        conn.execute("DELETE FROM cycle_periods WHERE id = ? AND user_id = ?", (period_id, db.uid()))
    return health_stats()


INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}, "points": {"type": "array", "items": {"type": "string"}}},
    "required": ["summary", "points"],
}


@router.post("/api/cycle/insight")
def insight(x_health_token: str = Header(default="")):
    require_eligible()
    require_token(x_health_token)
    data = health_stats()
    if not ai.available():
        raise HTTPException(503, "The AI coach is offline right now")
    context = {
        "summary": data["summary"],
        "recent_cycle_lengths": [entry["length"] for entry in data["lengths"][-6:]],
        "training_by_cycle_day_group": data["phases"],
        "symptom_averages_by_cycle_day": data["symptom_map"],
        "gentle_flags_already_shown": data["flags"],
    }
    system = (
        "You write a short monthly health and training review for one woman, based only on her own logged numbers. "
        "Strength is a percentage of her own typical performance, effort is her own rating, symptoms are 0 to 3, energy, sleep and mood are 1 to 5. "
        "Point out her personal patterns between symptoms, energy, sleep and training. Be warm, concrete and brief. "
        "Never diagnose, never name diseases, never give medication advice, never tell her to train through pain. "
        "Never recommend training less or resting just because of a cycle phase; base suggestions only on her own logged symptoms and energy. "
        "If there is little data, say so and suggest what to log. Write in clear, simple English. Answer only with JSON for the schema."
    )
    try:
        raw = ai.chat_json(json.dumps(context), INSIGHT_SCHEMA, timeout=60, system=system, temperature=0.3)
    except Exception as error:
        raise HTTPException(503, "The AI coach could not answer: " + str(error))
    result = {"summary": (raw.get("summary") or "")[:800], "points": [point[:300] for point in (raw.get("points") or [])[:6]], "created": db.now_iso()}
    with db.transaction() as conn:
        db.set_user_setting(conn, "cycle_insight", json.dumps(result))
    return result


def token_user(token):
    try:
        return int(token.split(".")[0])
    except (ValueError, AttributeError):
        raise HTTPException(423, "Health data is locked")


@router.get("/api/cycle/export")
def export(token: str = Query(default="")):
    with db.as_user(token_user(token)):
        return build_export(token)


def build_export(token):
    require_eligible()
    require_token(token)
    payload = {
        "periods": all_periods(),
        "days": db.query_all("SELECT * FROM cycle_days WHERE user_id = ? ORDER BY day", (db.uid(),)),
        "exported": db.now_iso(),
    }
    return JSONResponse(payload, headers={"Content-Disposition": "attachment; filename=cycle-data.json"})


@router.get("/api/cycle/report", response_class=HTMLResponse)
def report(token: str = Query(default="")):
    with db.as_user(token_user(token)):
        return build_report(token)


def build_report(token):
    require_eligible()
    require_token(token)
    data = health_stats()
    name = html_escape(db.query_one("SELECT name FROM users WHERE id = ?", (db.uid(),))["name"])
    summary = data["summary"]

    def cell(value):
        return "" if value is None else str(value)

    rows = "".join(
        "<tr><td>" + cycle["start"] + "</td><td>" + cell(cycle["end"]) + "</td><td>" + cell(cycle["period_length"]) + "</td><td>" + cell(cycle["cycle_length"]) + "</td></tr>"
        for cycle in data["cycles"][:12]
    )
    symptom_rows = "".join(
        "<tr><td>" + str(entry["cycle_day"]) + "</td>" + "".join("<td>" + cell(entry[key]) + "</td>" for key in ("energy", "cramps", "back_pain", "headache", "bloating", "flow")) + "</tr>"
        for entry in data["symptom_map"] if entry["cycle_day"] <= 10
    )
    flags = "".join("<li>" + html_escape(flag) + "</li>" for flag in data["flags"]) or "<li>None</li>"
    html = (
        "<!doctype html><html><head><meta charset='utf-8'><title>Cycle report</title><style>"
        "body{font-family:system-ui,sans-serif;margin:32px;color:#111;max-width:800px}h1{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:8px 0 20px}"
        "td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:13px}th{background:#f3f3f3}.muted{color:#666;font-size:13px}"
        "@media print{button{display:none}}</style></head><body>"
        "<button onclick='window.print()'>Print or save as PDF</button>"
        "<h1>Cycle report</h1><p class='muted'>" + name + ", created " + date.today().isoformat() + ". Self logged data from a home training app, not a medical record.</p>"
        "<h2>Summary</h2><table><tr><th>Cycles tracked</th><td>" + cell(summary["cycles_tracked"]) + "</td></tr>"
        "<tr><th>Average cycle length</th><td>" + cell(summary["average_cycle"]) + " days</td></tr>"
        "<tr><th>Shortest and longest recent cycle</th><td>" + cell(summary["shortest"]) + " and " + cell(summary["longest"]) + " days</td></tr>"
        "<tr><th>Average period length</th><td>" + cell(summary["average_period"]) + " days</td></tr>"
        "<tr><th>Pattern</th><td>" + summary["regularity"] + "</td></tr></table>"
        "<h2>Notes</h2><ul>" + flags + "</ul>"
        "<h2>Periods</h2><table><tr><th>Start</th><th>End</th><th>Period days</th><th>Cycle length</th></tr>" + rows + "</table>"
        "<h2>Average symptoms on period days</h2><p class='muted'>Energy 1 to 5, symptoms and flow 0 to 3.</p>"
        "<table><tr><th>Cycle day</th><th>Energy</th><th>Cramps</th><th>Back pain</th><th>Headache</th><th>Bloating</th><th>Flow</th></tr>" + symptom_rows + "</table>"
        "</body></html>"
    )
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@router.post("/api/cycle/erase")
def erase(body: UnlockIn):
    require_eligible()
    throttle()
    if not check_pin(body.pin):
        raise HTTPException(403, "Wrong PIN")
    with db.transaction() as conn:
        for table in ("cycle_periods", "cycle_days", "cycle_adjustments"):
            conn.execute("DELETE FROM " + table + " WHERE user_id = ?", (db.uid(),))
        conn.execute("DELETE FROM user_settings WHERE user_id = ? AND key IN ('health_pin', 'cycle_insight')", (db.uid(),))
    return {"erased": True}

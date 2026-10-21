import json
import math
import threading
import time
from datetime import date, timedelta

import ai
import catalog
import db
import nutrition
import engine
import exercise_notes
import planner

LEVEL_VOLUME = {
    "beginner": {"normal": (6, 10), "priority": (10, 14), "maintenance": 4},
    "intermediate": {"normal": (10, 16), "priority": (14, 20), "maintenance": 5},
    "advanced": {"normal": (12, 18), "priority": (16, 22), "maintenance": 6},
}
MAX_WEEKLY_SETS = 24
MAX_SESSION_MUSCLE_SETS = 10
PUSH_PATTERNS = {"horizontal_push", "incline_push", "vertical_push", "dip", "chest_fly"}
PULL_PATTERNS = {"horizontal_pull", "vertical_pull", "rear_delt"}
BIG_MUSCLES = {"chest", "lats", "upper_back", "quads", "hamstrings", "glutes"}
TRAINABLE = [muscle for muscle in planner.MAJOR_MUSCLES if muscle != "front_delts"]
REBUILD_REASONS = {
    "not_feeling": "Some exercises do not let me feel the target muscle",
    "pain": "Some exercises cause pain or discomfort",
    "boring": "The program got boring, I want new exercises",
    "too_long": "Sessions take too long",
    "too_short": "Sessions are too short or too easy",
    "too_hard": "The program is too hard or I cannot recover",
    "no_progress": "I am not progressing",
    "goal_change": "My goals or focus changed",
    "schedule": "My schedule changed",
    "equipment": "My equipment changed",
}

_running = set()
_running_lock = threading.Lock()


class ArchitectError(RuntimeError):
    pass


def profile_of(user):
    return {
        "name": user["name"],
        "sex": user["sex"],
        "age": user["age"],
        "height_cm": user["height_cm"],
        "weight_kg": user["weight_kg"],
        "experience": user["experience"],
        "trained_recently": bool(user["trained_recently"]),
        "goal": user["goal"],
        "days_per_week": user["days_per_week"],
        "session_minutes": user["session_minutes"] or 60,
        "priority_muscles": json.loads(user["priority_muscles"] or "[]"),
        "limitations": user["limitations"] or "",
    }


def _round(value):
    return int(value) if float(value).is_integer() else round(value, 2)


def equipment_context():
    equipment = db.equipment_map()
    owned = [item for item in equipment.values() if item["available"]]
    lines = []
    for item in sorted(owned, key=lambda entry: entry["key"]):
        line = "* " + item["name"] + " (key " + item["key"] + ")"
        if item.get("weights"):
            line += ": available loads " + ", ".join(str(_round(value)) for value in item["weights"]) + " kg"
        if item.get("notes"):
            line += ". " + item["notes"]
        lines.append(line)
    missing = [item["name"] for item in equipment.values() if not item["available"]]
    return equipment, lines, missing


def max_load(exercise, equipment):
    key = exercise.get("load_equipment")
    if key and key in equipment and equipment[key].get("weights"):
        return max(equipment[key]["weights"])
    return None


def allowed_library(equipment, avoid_ids=()):
    result = []
    for exercise in engine.library_exercises():
        if exercise["measure"] not in ("reps", "sec", "min", "none"):
            continue
        if not engine.available_exercise(exercise, equipment):
            continue
        if exercise["id"] in avoid_ids:
            continue
        info = dict(exercise)
        info["notes"] = exercise_notes.lookup(exercise["name"])
        info["max_load"] = max_load(exercise, equipment)
        result.append(info)
    return result


def library_lines(library):
    lines = []
    for exercise in sorted(library, key=lambda entry: (entry["primary_muscle"] or "", entry["name"])):
        notes = exercise["notes"]
        parts = [
            "id=" + str(exercise["id"]),
            exercise["name"],
            "measure " + exercise["measure"],
            "primary " + str(exercise["primary_muscle"]),
        ]
        if exercise["secondary_muscles"]:
            parts.append("secondary " + "/".join(exercise["secondary_muscles"]))
        parts.append("pattern " + str(exercise["pattern"]))
        parts.append("difficulty " + str(exercise["difficulty"]))
        if exercise["max_load"]:
            parts.append("max load " + str(_round(exercise["max_load"])) + " kg")
        if notes:
            parts.append("stretch " + ["low", "medium", "high"][notes["stretch"]])
            parts.append("stability " + ["low", "medium", "high"][notes["stability"]])
            if notes["unilateral"]:
                parts.append("unilateral")
            if notes["joint_stress"]:
                parts.append("stresses " + notes["joint_stress"])
            parts.append(notes["note"])
        lines.append("  " + " | ".join(parts))
    return lines


def history_context(user_id, weeks=6):
    since = (date.today() - timedelta(days=7 * weeks)).isoformat()
    sessions = db.query_all(
        "SELECT id, day, program_name, notes FROM sessions WHERE user_id = ? AND status = 'done' AND day >= ? ORDER BY day",
        (user_id, since),
    )
    if not sessions:
        return [], {}
    per_exercise = {}
    for session in sessions:
        entries = db.query_all("SELECT * FROM session_exercises WHERE session_id = ? ORDER BY position", (session["id"],))
        for entry in entries:
            sets = db.query_all("SELECT value, weight, effort FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number", (entry["id"],))
            done = [item for item in sets if item["value"] is not None]
            record = per_exercise.setdefault(entry["exercise_name"], {"exercise_id": entry["exercise_id"], "exposures": [], "skipped": 0})
            if not done:
                record["skipped"] += 1
                continue
            text = ", ".join(
                (engine.fmt(item["weight"]) + "kg x " if item["weight"] else "") + engine.fmt(item["value"]) +
                ({1: " easy", 2: " hard", 3: " max"}.get(item["effort"], ""))
                for item in done
            )
            top = max((item["weight"] or 0) for item in done) or None
            record["exposures"].append({
                "day": session["day"],
                "text": text,
                "planned": entry["planned_sets"],
                "target": entry["target"],
                "top_weight": top,
                "reps_at_top": max((item["value"] or 0) for item in done if (item["weight"] or 0) == (top or 0)),
            })
    feedback = {}
    for row in db.query_all(
        "SELECT e.name, f.rating, f.note FROM exercise_feedback f LEFT JOIN exercises e ON e.id = f.exercise_id WHERE f.user_id = ? AND f.created_at >= ?",
        (user_id, since),
    ):
        entry = feedback.setdefault(row["name"] or "unknown", {"good": 0, "weak": 0, "pain": 0, "notes": []})
        entry[row["rating"]] = entry.get(row["rating"], 0) + 1
        if row["note"]:
            entry["notes"].append(row["note"][:120])
    weeks_seen = max(1, (date.today() - date.fromisoformat(sessions[0]["day"])).days // 7 + 1)
    lines = ["Completed workouts in the last " + str(weeks) + " weeks: " + str(len(sessions)) + " (about " + str(round(len(sessions) / weeks_seen, 1)) + " per week)."]
    for name, record in sorted(per_exercise.items()):
        line = "* " + name + ": "
        recent = record["exposures"][-3:]
        line += " | ".join(point["day"] + " target " + (point["target"] or "free") + ": " + point["text"] for point in recent) if recent else "no sets logged"
        if record["skipped"]:
            line += " | skipped " + str(record["skipped"]) + " times"
        info = feedback.get(name)
        if info:
            line += " | feedback: felt well " + str(info["good"]) + ", did not feel target " + str(info["weak"]) + ", pain " + str(info["pain"])
            if info["notes"]:
                line += " (" + "; ".join(info["notes"][-3:]) + ")"
        lines.append(line)
    notes = [session["day"] + ": " + session["notes"][:160] for session in sessions if session["notes"]]
    if notes:
        lines.append("Workout notes from the person: " + " / ".join(notes[-6:]))
    return lines, per_exercise


def current_program(user_id):
    days = []
    for program in db.query_all("SELECT id, name, weekday, description FROM programs WHERE user_id = ? AND archived = 0 ORDER BY weekday, id", (user_id,)):
        items = db.query_all(
            """
            SELECT pe.sets, pe.target, pe.rest_seconds, pe.target_weight, e.id AS exercise_id, e.name
            FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id WHERE pe.program_id = ? ORDER BY pe.position
            """,
            (program["id"],),
        )
        days.append({"program": program, "items": items})
    return days


def volume_targets(level, priority, goal):
    table = LEVEL_VOLUME[level]
    targets = {}
    for muscle in TRAINABLE:
        low, high = table["priority"] if muscle in priority else table["normal"]
        if goal == "fat_loss":
            low, high = max(table["maintenance"], round(low * 0.85)), max(table["maintenance"] + 2, round(high * 0.85))
        if muscle in ("calves", "obliques") and muscle not in priority:
            low, high = table["maintenance"], max(table["maintenance"] + 2, round(high * 0.6))
        targets[muscle] = (low, high)
    return targets


ASSESS_SCHEMA = {
    "type": "object",
    "properties": {
        "understanding": {"type": "string"},
        "priority_muscles": {"type": "array", "items": {"type": "string"}},
        "avoid_exercise_ids": {"type": "array", "items": {"type": "integer"}},
        "pull_to_push_ratio": {"type": "number"},
        "lifting_days": {"type": "integer"},
        "design_notes": {"type": "string"},
    },
    "required": ["understanding", "priority_muscles", "avoid_exercise_ids", "pull_to_push_ratio", "lifting_days", "design_notes"],
}


def _assess(context):
    prompt = "\n".join([
        "Task: assess this person before a program is designed. Read everything, including free text in any language.",
        "Return:",
        "* understanding: 2 to 4 sentences in English about who this person is, what they want and what to watch out for.",
        "* priority_muscles: the muscles to emphasize, chosen only from: " + ", ".join(TRAINABLE) + ". Keep the person's stated priorities and add at most two that clearly follow from their goals or limitations text. At most 5.",
        "* avoid_exercise_ids: ids from the library that this person should not do because of pain, limitations, device limits or their own feedback. Empty if none.",
        "* pull_to_push_ratio: minimum weekly pulling sets divided by pressing sets (0.8 normally, 1.2 to 1.5 for posture problems or shoulder pain).",
        "* lifting_days: how many of the training days should be resistance training days (the rest become cardio, core or recovery days), following the guide for this level.",
        "* design_notes: concrete instructions for the program designer (split, emphasis, exercises to keep or drop, recovery, load limits).",
        "",
        context,
    ])
    return ai.chat_json(prompt, ASSESS_SCHEMA, timeout=300, system=ai.expert_system_prompt())


DESIGN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "split": {"type": "string"},
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "weekday": {"type": "integer"},
                    "name": {"type": "string"},
                    "focus": {"type": "string"},
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
                                "rest_seconds": {"type": "integer"},
                                "cue": {"type": "string"},
                            },
                            "required": ["exercise_id", "sets", "rep_min", "rep_max", "rest_seconds", "cue"],
                        },
                    },
                },
                "required": ["weekday", "name", "focus", "note", "items"],
            },
        },
    },
    "required": ["summary", "split", "days"],
}

DESIGN_RULES = [
    "Output rules:",
    "* One entry in days per training weekday listed in the schedule, weekday 0 is Monday and 6 is Sunday. No other days.",
    "* items are in the order the person performs them: priority and compound work first.",
    "* For measure reps: rep_min and rep_max are reps (3 to 30, spread of at least 3). For measure sec: seconds per set. For measure min (cardio): sets 1 and rep_min = rep_max = minutes. For measure none: sets is the number of rounds, rep_min = rep_max = 0.",
    "* rest_seconds: 120 to 180 for demanding compounds, 60 to 90 for isolations, 0 for cardio.",
    "* cue: one short, specific execution cue for this person (under 15 words).",
    "* name: 2 to 4 words that say what the day trains. note: one sentence focus for the day.",
    "* summary: 3 to 5 sentences for the person, addressing them by name, explaining the plan and why it fits them.",
    "* Never exceed the session time. Never use an exercise id that is not in the library list. Never use an exercise twice on the same day.",
]


def _design(context, feedback=""):
    prompt = "\n".join(
        ["Task: design this person's complete weekly training program following the coaching guide."]
        + DESIGN_RULES
        + ([""] + ["Your previous version had these problems. Fix all of them and keep what was good:", feedback] if feedback else [])
        + ["", context]
    )
    return ai.chat_json(prompt, DESIGN_SCHEMA, timeout=600, system=ai.expert_system_prompt(), temperature=0.35)


CRITIC_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer"},
        "verdict": {"type": "string"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"severity": {"type": "string"}, "problem": {"type": "string"}, "fix": {"type": "string"}},
                "required": ["severity", "problem", "fix"],
            },
        },
    },
    "required": ["score", "verdict", "issues"],
}


def _critique(context, rendered):
    prompt = "\n".join([
        "Task: you are a strict senior coach reviewing a program written by a junior coach for this person.",
        "Judge it against the coaching guide, the person's goals, sex, age, level, limitations, history, feedback and exact equipment.",
        "Check: weekly volume per muscle, frequency, priorities, push and pull balance, exercise choice (stretch, stability, load limits, joint stress), "
        "order, session time, recovery between days, rep ranges versus available loads, and whether the person will enjoy and keep doing it.",
        "Give a score from 0 to 100 (90 or more only for a program you would hand to a paying client unchanged).",
        "List concrete issues with severity high, medium or low and a precise fix that names exercise ids or days. Do not list praise as issues.",
        "",
        context,
        "",
        "=== PROGRAM TO REVIEW ===",
        rendered,
    ])
    return ai.chat_json(prompt, CRITIC_SCHEMA, timeout=300, system=ai.expert_system_prompt(), temperature=0.1)


def _with_retry(call, tries=3, wait=45):
    for attempt in range(tries):
        try:
            return call()
        except ValueError:
            raise
        except Exception as error:
            if attempt + 1 >= tries or not any(code in str(error) for code in (" 429", " 500", " 503", "not reachable", "timed out")):
                raise
            time.sleep(wait * (attempt + 1))


def _estimate_minutes(items, library_by_id):
    total = 5.0
    for item in items:
        exercise = library_by_id.get(item["exercise_id"])
        if not exercise:
            continue
        if exercise["measure"] == "min":
            total += item["rep_min"]
            continue
        if exercise["measure"] == "none":
            total += item["sets"] * 2.5
            continue
        notes = exercise["notes"] or {}
        work = 50 if exercise["measure"] == "reps" else (item["rep_max"] or 30) + 10
        if notes.get("unilateral"):
            work *= 2
        total += item["sets"] * (work + item["rest_seconds"]) / 60.0
    return total


def analyse(design, context_info):
    library_by_id = context_info["library_by_id"]
    profile = context_info["profile"]
    level = context_info["level"]
    problems = []
    warnings = []
    weekly = {muscle: 0.0 for muscle in TRAINABLE + ["front_delts", "forearms"]}
    push = pull = 0.0
    cardio_minutes = 0
    schedule = set(context_info["weekdays"])
    seen_weekdays = set()
    day_reports = []
    per_day_muscles = {}
    lifting_days = 0
    for day in design.get("days", []):
        weekday = day.get("weekday")
        label = "day " + str(weekday) + " (" + str(day.get("name", "")) + ")"
        if weekday not in schedule:
            problems.append(label + ": weekday is not in the schedule " + str(sorted(schedule)))
            continue
        if weekday in seen_weekdays:
            problems.append(label + ": weekday used twice")
            continue
        seen_weekdays.add(weekday)
        used = set()
        muscles_today = {}
        strength_sets = 0
        clean_items = []
        for item in day.get("items", []):
            exercise = library_by_id.get(item.get("exercise_id"))
            if not exercise:
                problems.append(label + ": exercise id " + str(item.get("exercise_id")) + " is not allowed")
                continue
            if exercise["id"] in used:
                problems.append(label + ": " + exercise["name"] + " appears twice")
                continue
            used.add(exercise["id"])
            sets = int(item.get("sets") or 0)
            rep_min = item.get("rep_min")
            rep_max = item.get("rep_max")
            rest = int(item.get("rest_seconds") or 0)
            measure = exercise["measure"]
            if measure == "min":
                if not rep_min or rep_min < 5 or rep_min > 75:
                    problems.append(label + ": " + exercise["name"] + " needs 5 to 75 minutes")
                cardio_minutes += rep_min or 0
            elif measure == "none":
                pass
            else:
                if sets < 1 or sets > 6:
                    problems.append(label + ": " + exercise["name"] + " has " + str(sets) + " sets (allowed 1 to 6)")
                if measure == "reps":
                    if not rep_min or not rep_max or rep_min < 3 or rep_max > 30 or rep_max - rep_min < 2:
                        problems.append(label + ": " + exercise["name"] + " rep range " + str(rep_min) + " to " + str(rep_max) + " is invalid (3 to 30, spread at least 3)")
                    notes = exercise["notes"] or {}
                    limit = exercise["max_load"]
                    history_top = context_info["history_top"].get(exercise["id"])
                    reps_done = context_info["history_reps"].get(exercise["id"], 0)
                    if limit and history_top and history_top >= limit - 0.01 and rep_max and reps_done >= rep_max:
                        problems.append(label + ": " + exercise["name"] + " is already done for " + str(reps_done) + " reps with the heaviest available load (" +
                                        str(_round(limit)) + " kg); the rep range must go above " + str(reps_done) + " or use a harder variation")
                    elif limit and history_top and history_top >= limit - 0.01 and rep_min and reps_done and rep_min > reps_done + 2:
                        problems.append(label + ": " + exercise["name"] + " rep range starts at " + str(rep_min) + " but the person does only " + str(reps_done) +
                                        " reps with the heaviest load (" + str(_round(limit)) + " kg); start the range near " + str(reps_done))
                    elif limit and notes.get("load_need") == "heavy" and limit <= 12 and rep_min and rep_min < 8 and profile["sex"] == "male" and level != "beginner":
                        warnings.append(label + ": " + exercise["name"] + " with at most " + str(_round(limit)) + " kg will be too light for " + str(rep_min) + " reps")
                if measure == "sec" and (not rep_min or rep_min < 10 or (rep_max or 0) > 180):
                    problems.append(label + ": " + exercise["name"] + " time range invalid")
                if exercise["difficulty"] >= 3 and level == "beginner":
                    problems.append(label + ": " + exercise["name"] + " is too difficult for a beginner")
                if exercise["primary_muscle"] not in ("cardio", "mobility"):
                    strength_sets += sets
                    primary = exercise["primary_muscle"]
                    weekly[primary] = weekly.get(primary, 0) + sets
                    muscles_today[primary] = muscles_today.get(primary, 0) + sets
                    for muscle in exercise["secondary_muscles"]:
                        weekly[muscle] = weekly.get(muscle, 0) + sets * 0.5
                    if exercise["pattern"] in PUSH_PATTERNS:
                        push += sets
                    if exercise["pattern"] in PULL_PATTERNS:
                        pull += sets
            clean_items.append(item)
        minutes = _estimate_minutes(clean_items, library_by_id)
        if minutes > profile["session_minutes"] * 1.15 + 5:
            problems.append(label + ": about " + str(round(minutes)) + " minutes, longer than the " + str(profile["session_minutes"]) + " minute limit")
        for muscle, count in muscles_today.items():
            if count > MAX_SESSION_MUSCLE_SETS:
                problems.append(label + ": " + str(count) + " direct sets for " + muscle + " in one session (max " + str(MAX_SESSION_MUSCLE_SETS) + ")")
        if strength_sets >= 6:
            lifting_days += 1
        per_day_muscles[weekday] = muscles_today
        day_reports.append(label + ": about " + str(round(minutes)) + " min, " + str(strength_sets) + " strength sets")
    missing_days = schedule - seen_weekdays
    if missing_days:
        problems.append("missing training days: " + ", ".join(planner.WEEKDAY_NAMES[day] for day in sorted(missing_days)))
    targets = context_info["targets"]
    priority = context_info["priority"]
    maintenance = LEVEL_VOLUME[level]["maintenance"]
    for muscle in TRAINABLE:
        low, high = targets[muscle]
        value = weekly.get(muscle, 0)
        if muscle in priority and value < low * 0.9:
            problems.append("priority muscle " + muscle + " gets only " + str(round(value, 1)) + " weekly sets (target " + str(low) + " to " + str(high) + ")")
        elif muscle not in priority and value < maintenance and muscle not in ("calves", "obliques"):
            problems.append(muscle + " gets only " + str(round(value, 1)) + " weekly sets (at least " + str(maintenance) + ")")
        elif value > max(high + 4, MAX_WEEKLY_SETS if muscle in priority else high + 4):
            problems.append(muscle + " gets " + str(round(value, 1)) + " weekly sets, too much (target " + str(low) + " to " + str(high) + ")")
        elif value < low and muscle not in ("calves", "obliques"):
            warnings.append(muscle + " is below its target (" + str(round(value, 1)) + " of " + str(low) + " to " + str(high) + ")")
    ratio = context_info["pull_ratio"]
    if push and pull < push * ratio - 0.5:
        problems.append("pulling sets " + str(round(pull)) + " versus pressing sets " + str(round(push)) + ": pull must be at least " + str(ratio) + " times push")
    if level == "beginner" and lifting_days > 4:
        problems.append("a beginner should have at most 4 resistance days, this plan has " + str(lifting_days))
    if lifting_days >= 7:
        problems.append("7 hard training days leave no recovery")
    weekdays_sorted = sorted(per_day_muscles)
    for first, second in zip(weekdays_sorted, weekdays_sorted[1:]):
        if second - first != 1:
            continue
        for muscle in BIG_MUSCLES:
            if per_day_muscles[first].get(muscle, 0) >= 4 and per_day_muscles[second].get(muscle, 0) >= 4:
                warnings.append(muscle + " is trained hard on two consecutive days (" + planner.WEEKDAY_NAMES[first] + " and " + planner.WEEKDAY_NAMES[second] + ")")
    cardio_target = context_info["cardio_target"]
    if cardio_target and cardio_minutes < cardio_target * 0.6:
        warnings.append("cardio " + str(cardio_minutes) + " minutes per week, target about " + str(cardio_target))
    report = ["Weekly sets per muscle (primary 1, secondary 0.5):"]
    for muscle in TRAINABLE:
        low, high = targets[muscle]
        report.append("  " + muscle + ": " + str(round(weekly.get(muscle, 0), 1)) + " (target " + str(low) + " to " + str(high) + (", priority" if muscle in priority else "") + ")")
    report.append("Pressing sets " + str(round(push)) + ", pulling sets " + str(round(pull)) + ", cardio " + str(cardio_minutes) + " minutes, resistance days " + str(lifting_days))
    report.extend(day_reports)
    return {"problems": problems, "warnings": warnings, "report": report, "weekly": weekly}


def render(design, library_by_id):
    lines = ["Split: " + str(design.get("split", ""))]
    for day in sorted(design.get("days", []), key=lambda entry: entry.get("weekday", 9)):
        weekday = day.get("weekday")
        name = planner.WEEKDAY_NAMES[weekday] if isinstance(weekday, int) and 0 <= weekday <= 6 else str(weekday)
        lines.append(name + " (weekday " + str(weekday) + "): " + str(day.get("name")) + " | focus: " + str(day.get("focus")))
        for item in day.get("items", []):
            exercise = library_by_id.get(item.get("exercise_id"))
            label = exercise["name"] if exercise else "UNKNOWN id " + str(item.get("exercise_id"))
            measure = exercise["measure"] if exercise else "reps"
            if measure == "min":
                amount = str(item.get("rep_min")) + " min"
            elif measure == "none":
                amount = str(item.get("sets")) + " rounds"
            else:
                amount = str(item.get("sets")) + " x " + str(item.get("rep_min")) + " to " + str(item.get("rep_max")) + (" s" if measure == "sec" else "")
            lines.append("  id=" + str(item.get("exercise_id")) + " " + label + ": " + amount + ", rest " + str(item.get("rest_seconds")) + " s. Cue: " + str(item.get("cue", "")))
    return "\n".join(lines)


def build_context(user_id, request=None):
    request = request or {}
    user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not user:
        raise ArchitectError("unknown user")
    profile = profile_of(user)
    if request.get("days_per_week"):
        profile["days_per_week"] = int(request["days_per_week"])
    if request.get("session_minutes"):
        profile["session_minutes"] = int(request["session_minutes"])
    level = planner.derive_level(profile["experience"], profile["trained_recently"])
    goal = profile["goal"] if profile["goal"] in planner.GOALS else "health"
    equipment, equipment_lines, missing = equipment_context()
    library = allowed_library(equipment)
    with db.as_user(user_id):
        history_lines, per_exercise = history_context(user_id)
    history_lines = list(history_lines) + nutrition.prompt_lines(user_id)
    current = current_program(user_id)
    keep_schedule = bool(request.get("keep_schedule")) and bool(current)
    if keep_schedule:
        weekdays = sorted({day["program"]["weekday"] for day in current if day["program"]["weekday"] is not None})
    else:
        days = max(1, min(7, int(profile["days_per_week"])))
        weekdays = planner.WEEKDAY_LAYOUT[days]
    history_top = {}
    history_reps = {}
    for name, record in per_exercise.items():
        recent = [point for point in record["exposures"] if point["top_weight"]][-2:]
        if recent and record["exercise_id"]:
            best = max(recent, key=lambda point: (point["top_weight"], point["reps_at_top"]))
            history_top[record["exercise_id"]] = best["top_weight"]
            history_reps[record["exercise_id"]] = best["reps_at_top"]
    bmi, bmi_label = planner.bmi_info(profile.get("height_cm"), profile.get("weight_kg"))
    lines = ["=== PERSON ==="]
    lines.append("Name: " + profile["name"] + ". Sex: " + profile["sex"] + (". Age: " + str(profile["age"]) if profile["age"] else ""))
    if profile.get("height_cm") and profile.get("weight_kg"):
        lines.append("Height " + str(_round(profile["height_cm"])) + " cm, weight " + str(_round(profile["weight_kg"])) + " kg, BMI " + str(bmi) + " (" + bmi_label + ").")
    lines.append("Experience: " + planner.EXPERIENCE.get(profile["experience"], profile["experience"]) + ("; trained in the last 3 months" if profile["trained_recently"] else "; not trained in the last 3 months") + ". Level: " + level + ".")
    lines.append("Main goal: " + planner.GOALS[goal] + ".")
    lines.append("Stated priority muscles: " + (", ".join(profile["priority_muscles"]) or "none") + ".")
    lines.append("Training days per week: " + str(len(weekdays)) + " on " + ", ".join(planner.WEEKDAY_NAMES[day] + " (" + str(day) + ")" for day in weekdays) + ". Session length: " + str(profile["session_minutes"]) + " minutes.")
    if profile["limitations"]:
        lines.append("Limitations and wishes in the person's own words: " + profile["limitations"])
    reasons = [REBUILD_REASONS[key] for key in request.get("reasons", []) if key in REBUILD_REASONS]
    if reasons or request.get("details"):
        lines.append("")
        lines.append("=== WHY THE PERSON ASKED FOR A NEW PROGRAM ===")
        lines.extend("* " + reason for reason in reasons)
        if request.get("details"):
            lines.append("In their words: " + request["details"][:800])
    if keep_schedule:
        lines.append("")
        lines.append("=== CURRENT PROGRAM (the person likes this day structure: keep the same weekdays and the same focus per day, improve exercises, sets and order) ===")
    elif current:
        lines.append("")
        lines.append("=== CURRENT PROGRAM (for reference) ===")
    for day in current:
        program = day["program"]
        weekday = program["weekday"]
        lines.append((planner.WEEKDAY_NAMES[weekday] if weekday is not None else "no weekday") + ": " + program["name"])
        for item in day["items"]:
            lines.append("  " + item["name"] + " " + str(item["sets"]) + " x " + str(item["target"]) + (" at " + engine.fmt(item["target_weight"]) + " kg" if item["target_weight"] else ""))
    if history_lines:
        lines.append("")
        lines.append("=== TRAINING HISTORY (weights are per dumbbell for dumbbell exercises; older logs may contain totals) ===")
        lines.extend(history_lines)
    lines.append("")
    lines.append("=== EQUIPMENT IN THIS HOME GYM ===")
    lines.extend(equipment_lines)
    if missing:
        lines.append("Not available: " + ", ".join(missing) + ".")
    lines.append("")
    lines.append("=== EXERCISE LIBRARY (only these ids are allowed) ===")
    lines.extend(library_lines(library))
    return {
        "user": user,
        "profile": profile,
        "level": level,
        "goal": goal,
        "weekdays": weekdays,
        "keep_schedule": keep_schedule,
        "library": library,
        "library_by_id": {exercise["id"]: exercise for exercise in library},
        "history_top": history_top,
        "history_reps": history_reps,
        "current": current,
        "base_text": "\n".join(lines),
        "cardio_target": planner.CARDIO_MINUTES.get(goal, 150),
    }


def _targets_text(context_info):
    lines = ["=== WEEKLY VOLUME TARGETS (hard sets, primary 1 and secondary 0.5) ==="]
    for muscle in TRAINABLE:
        low, high = context_info["targets"][muscle]
        lines.append("  " + muscle + ": " + str(low) + " to " + str(high) + (" (priority)" if muscle in context_info["priority"] else ""))
    lines.append("Front delts need no direct work when there is pressing. Minimum pulling to pressing ratio: " + str(context_info["pull_ratio"]) + ".")
    lines.append("Weekly cardio target: about " + str(context_info["cardio_target"]) + " minutes. Resistance days: " + str(context_info["lifting_days"]) + ".")
    lines.append("Time budget: a " + str(context_info["profile"]["session_minutes"]) + " minute resistance day holds about " + str(context_info["sets_per_day"]) +
                 " hard sets including rest. Every 3 minutes of cardio on that day costs about one set. Days that exceed the session length are rejected.")
    if context_info.get("volume_scaled"):
        lines.append("The targets above are already reduced to fit the available training time. Priorities still come first.")
    return "\n".join(lines)


def _score(analysis, critic):
    base = critic.get("score", 50) if critic else 50
    high = sum(1 for issue in (critic or {}).get("issues", []) if str(issue.get("severity", "")).lower() == "high")
    return base - 12 * len(analysis["problems"]) - 2 * len(analysis["warnings"]) - 5 * high


def design_program(user_id, request=None, progress=None, attempts=3):
    def say(message):
        if progress:
            progress(message)

    context_info = build_context(user_id, request)
    say("Reading your profile, history and equipment")
    assessment = {}
    try:
        assessment = _with_retry(lambda: _assess(context_info["base_text"]))
    except Exception as error:
        print("assessment failed, continuing without it:", error, flush=True)
        assessment = {}
    stated = [muscle for muscle in context_info["profile"]["priority_muscles"] if muscle in TRAINABLE]
    extra = [muscle for muscle in assessment.get("priority_muscles", []) if muscle in TRAINABLE and muscle not in stated]
    priority = (stated + extra)[:5]
    avoid = {value for value in assessment.get("avoid_exercise_ids", []) if isinstance(value, int)}
    if avoid:
        context_info["library"] = [exercise for exercise in context_info["library"] if exercise["id"] not in avoid]
        context_info["library_by_id"] = {exercise["id"]: exercise for exercise in context_info["library"]}
    ratio = assessment.get("pull_to_push_ratio") or 0.8
    context_info["pull_ratio"] = round(max(0.8, min(1.6, float(ratio))), 2)
    lifting = assessment.get("lifting_days") or len(context_info["weekdays"])
    context_info["lifting_days"] = max(1, min(len(context_info["weekdays"]), int(lifting)))
    context_info["priority"] = priority
    targets = volume_targets(context_info["level"], priority, context_info["goal"])
    minutes = context_info["profile"]["session_minutes"]
    sets_per_day = max(6, int((minutes - 5) * 60 / 155))
    context_info["sets_per_day"] = sets_per_day
    capacity = sets_per_day * context_info["lifting_days"] * 1.5
    maintenance = LEVEL_VOLUME[context_info["level"]]["maintenance"]
    counted = [muscle for muscle in TRAINABLE if muscle not in ("calves", "obliques")]
    required = sum(targets[muscle][0] for muscle in counted)
    context_info["volume_scaled"] = False
    if required > capacity:
        factor = capacity / required
        context_info["volume_scaled"] = True
        for muscle in TRAINABLE:
            low, high = targets[muscle]
            floor = maintenance + (2 if muscle in priority else 0)
            if muscle in ("calves", "obliques"):
                floor = 0 if muscle not in priority else maintenance
            new_low = max(floor, int(round(low * factor)))
            targets[muscle] = (new_low, max(new_low + 2, int(round(high * factor))))
    context_info["targets"] = targets
    context_info["assessment"] = assessment
    assessment_text = "\n".join([
        "=== HEAD COACH ASSESSMENT ===",
        assessment.get("understanding", ""),
        "Design notes: " + assessment.get("design_notes", ""),
        "Priority muscles: " + (", ".join(priority) or "none"),
        "Excluded exercise ids: " + (", ".join(str(value) for value in sorted(avoid)) or "none"),
    ])
    full_context = context_info["base_text"] + "\n\n" + assessment_text + "\n\n" + _targets_text(context_info)
    if avoid:
        full_context = full_context.replace("=== EXERCISE LIBRARY (only these ids are allowed) ===", "=== EXERCISE LIBRARY (only these ids are allowed; ids " + ", ".join(str(value) for value in sorted(avoid)) + " are excluded) ===")

    best = None
    feedback = ""
    history = []
    for attempt in range(attempts):
        say("Designing your program, draft " + str(attempt + 1))
        try:
            design = _with_retry(lambda: _design(full_context, feedback))
        except ValueError:
            feedback = "The answer was not valid JSON for the schema."
            continue
        except Exception as error:
            if best is not None:
                break
            raise ArchitectError("the AI is not reachable right now: " + str(error)[:200])
        analysis = analyse(design, context_info)
        rendered = render(design, context_info["library_by_id"])
        say("A senior coach is reviewing draft " + str(attempt + 1))
        try:
            critic = _critique(full_context, rendered + "\n\n=== AUTOMATIC CHECKS ===\n" + "\n".join(analysis["report"]) +
                               ("\nRule violations: " + "; ".join(analysis["problems"]) if analysis["problems"] else ""))
        except Exception as error:
            print("critic failed:", error, flush=True)
            critic = {"score": 60, "verdict": "", "issues": []}
        score = _score(analysis, critic)
        history.append({"attempt": attempt + 1, "score": score, "critic": critic.get("score"), "problems": analysis["problems"], "warnings": analysis["warnings"]})
        if best is None or score > best["score"]:
            best = {"design": design, "analysis": analysis, "critic": critic, "score": score, "rendered": rendered}
        serious = [issue for issue in critic.get("issues", []) if str(issue.get("severity", "")).lower() in ("high", "medium")]
        if not analysis["problems"] and critic.get("score", 0) >= 88 and not any(str(issue.get("severity", "")).lower() == "high" for issue in serious):
            break
        parts = []
        if analysis["problems"]:
            parts.append("Rule violations (must fix): " + "; ".join(analysis["problems"]))
        if analysis["warnings"]:
            parts.append("Warnings: " + "; ".join(analysis["warnings"]))
        if serious:
            parts.append("Senior coach review: " + "; ".join(str(issue.get("problem")) + " Fix: " + str(issue.get("fix")) for issue in serious))
        feedback = "\n".join(parts) + "\n\nYour previous version:\n" + rendered
    if best is None:
        raise ArchitectError("the AI did not return a usable program")
    best["design"] = _repair(best["design"], context_info)
    best["analysis"] = analyse(best["design"], context_info)
    best["context"] = context_info
    best["history"] = history
    return best


def _repair(design, context_info):
    library_by_id = context_info["library_by_id"]
    schedule = context_info["weekdays"]
    days = {}
    for day in design.get("days", []):
        weekday = day.get("weekday")
        if weekday not in schedule or weekday in days:
            continue
        items = []
        used = set()
        for item in day.get("items", []):
            exercise = library_by_id.get(item.get("exercise_id"))
            if not exercise or exercise["id"] in used:
                continue
            used.add(exercise["id"])
            fixed = dict(item)
            measure = exercise["measure"]
            fixed["sets"] = max(1, min(6, int(item.get("sets") or 2)))
            if measure == "min":
                minutes = max(5, min(75, int(item.get("rep_min") or item.get("rep_max") or 20)))
                fixed.update({"sets": 1, "rep_min": minutes, "rep_max": minutes, "rest_seconds": 0})
            elif measure == "none":
                fixed.update({"rep_min": None, "rep_max": None})
            elif measure == "sec":
                low = max(10, min(120, int(item.get("rep_min") or 20)))
                high = max(low + 10, min(180, int(item.get("rep_max") or low + 20)))
                fixed.update({"rep_min": low, "rep_max": high})
            else:
                low = max(3, min(27, int(item.get("rep_min") or 8)))
                high = max(low + 3, min(30, int(item.get("rep_max") or low + 4)))
                fixed.update({"rep_min": low, "rep_max": high})
            fixed["rest_seconds"] = max(0, min(300, int(fixed.get("rest_seconds") or 0)))
            items.append(fixed)
        if items:
            days[weekday] = dict(day, items=items)
    design = dict(design)
    design["days"] = [days[weekday] for weekday in sorted(days)]
    return design


def _start_weight(exercise_id, context_info, equipment):
    top = context_info["history_top"].get(exercise_id)
    exercise = context_info["library_by_id"].get(exercise_id)
    if not top or not exercise or not exercise["track_weight"]:
        return None
    weights = None
    key = exercise.get("load_equipment")
    if key and key in equipment:
        weights = equipment[key].get("weights")
    if weights:
        possible = [value for value in weights if value <= top + 1e-6]
        return max(possible) if possible else min(weights)
    return top


def apply_design(user_id, result, kind="rebuild"):
    design = result["design"]
    context_info = result["context"]
    equipment = db.equipment_map()
    library_by_id = context_info["library_by_id"]
    summary = (design.get("summary") or "").strip()
    with db.as_user(user_id):
        block = engine.ensure_block()
        with db.transaction() as conn:
            previous = [row["id"] for row in conn.execute("SELECT id FROM programs WHERE user_id = ? AND archived = 0", (user_id,)).fetchall()]
            conn.execute("UPDATE programs SET archived = 1 WHERE user_id = ? AND archived = 0", (user_id,))
            created = []
            for day in design["days"]:
                description = (day.get("note") or "").strip()[:400]
                program_id = conn.execute(
                    "INSERT INTO programs (user_id, name, weekday, description, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, (day.get("name") or "Training").strip()[:60], day["weekday"], description, db.now_iso()),
                ).lastrowid
                created.append(program_id)
                for position, item in enumerate(day["items"]):
                    exercise = library_by_id[item["exercise_id"]]
                    rep_min, rep_max = item.get("rep_min"), item.get("rep_max")
                    conn.execute(
                        """
                        INSERT INTO program_exercises (program_id, exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, target_weight, added_block, cue)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (program_id, exercise["id"], position, item["sets"],
                         db.build_target(rep_min, rep_max, exercise["measure"], "1 round" if exercise["measure"] == "none" else ""),
                         item["rest_seconds"], rep_min, rep_max, _start_weight(exercise["id"], context_info, equipment), block["number"],
                         (item.get("cue") or "").strip()[:160]),
                    )
            db.set_user_setting(conn, "priority_muscles", json.dumps(context_info["priority"]), user_id)
            db.set_user_setting(conn, "goal_fat_loss", "1" if context_info["goal"] in ("fat_loss", "tone") else "0", user_id)
            db.set_user_setting(conn, "cardio_target_min", context_info["cardio_target"], user_id)
            db.set_user_setting(conn, "block_weeks", 6 if context_info["level"] == "beginner" else 5, user_id)
            db.set_user_setting(conn, "previous_programs", json.dumps(previous), user_id)
            db.set_user_setting(conn, "current_programs", json.dumps(created), user_id)
            conn.execute("UPDATE users SET status = 'ready', status_message = '', plan_summary = ?, rebuild_request = '' WHERE id = ?", (summary, user_id))
            title = "New program designed by the AI coach" if kind == "rebuild" else "First program written by the AI coach"
            details = summary + "\n\nSplit: " + str(design.get("split", "")) + ". Quality score: " + str(round(result["score"])) + "."
            if kind == "rebuild" and previous:
                details += " Your previous program is saved and can be restored."
            db.log_event(conn, "manual", "program_rebuilt" if kind == "rebuild" else "first_program", title, details, block_id=block["id"], source="ai")
            conn.execute(
                "INSERT INTO ai_runs (user_id, kind, created_at, score, attempts, problems, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, kind, db.now_iso(), result["score"], len(result["history"]), json.dumps(result["analysis"]["problems"] + result["analysis"]["warnings"]),
                 json.dumps({"history": result["history"], "assessment": context_info.get("assessment", {}), "report": result["analysis"]["report"]})[:20000]),
            )
    return created


def restore_previous(user_id):
    previous = json.loads(db.get_user_setting("previous_programs", "[]", user_id=user_id) or "[]")
    current = json.loads(db.get_user_setting("current_programs", "[]", user_id=user_id) or "[]")
    if not previous:
        return False
    with db.as_user(user_id):
        block = engine.ensure_block()
        with db.transaction() as conn:
            conn.execute("UPDATE programs SET archived = 1 WHERE user_id = ? AND archived = 0", (user_id,))
            for program_id in previous:
                conn.execute("UPDATE programs SET archived = 0 WHERE id = ? AND user_id = ?", (program_id, user_id))
            db.set_user_setting(conn, "previous_programs", json.dumps(current), user_id)
            db.set_user_setting(conn, "current_programs", json.dumps(previous), user_id)
            db.log_event(conn, "manual", "program_restored", "Previous program restored", "The program before the last rebuild is active again.", block_id=block["id"], source="manual")
    return True


def _set_status(user_id, status, message=""):
    with db.transaction() as conn:
        conn.execute("UPDATE users SET status = ?, status_message = ? WHERE id = ?", (status, message[:300], user_id))


def run_rebuild(user_id, request):
    with _running_lock:
        if user_id in _running:
            return
        _running.add(user_id)
    try:
        with db.as_user(user_id):
            engine.require_ai()
        _set_status(user_id, "generating", "Your coach is designing a new program")
        result = design_program(user_id, request, progress=lambda message: _set_status(user_id, "generating", message))
        apply_design(user_id, result, kind="rebuild")
    except Exception as error:
        _set_status(user_id, "ready", "")
        with db.transaction() as conn:
            conn.execute("UPDATE users SET rebuild_request = '' WHERE id = ?", (user_id,))
        with db.as_user(user_id):
            with db.transaction() as conn:
                db.log_event(conn, "manual", "rebuild_failed", "The new program could not be created",
                             "Your current program is unchanged. Reason: " + str(error)[:300], source="ai")
    finally:
        with _running_lock:
            _running.discard(user_id)


def start_rebuild(user_id, request):
    with db.transaction() as conn:
        conn.execute("UPDATE users SET status = 'generating', status_message = 'Your coach is preparing', rebuild_request = ? WHERE id = ?", (json.dumps(request), user_id))
    threading.Thread(target=run_rebuild, args=(user_id, request), daemon=True).start()


def is_running(user_id):
    with _running_lock:
        return user_id in _running

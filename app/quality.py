import json
import sys
import threading
import time
from pathlib import Path

import ai
import db
import engine
import onboarding
import planner

REPORT_DIR = db.DATA_DIR / "quality" if hasattr(db, "DATA_DIR") else Path("/data/quality")

PERSONAS = [
    {
        "key": "beginner_fat_loss",
        "profile": {
            "name": "Anna", "sex": "female", "age": 34, "height_cm": 168, "weight_kg": 82,
            "experience": "none", "trained_recently": False, "goal": "fat_loss",
            "days_per_week": 3, "session_minutes": 45, "priority_muscles": ["glutes", "abs"], "limitations": "",
        },
    },
    {
        "key": "intermediate_muscle_5d",
        "profile": {
            "name": "Ben", "sex": "male", "age": 28, "height_cm": 180, "weight_kg": 78,
            "experience": "6_to_24_months", "trained_recently": True, "goal": "muscle",
            "days_per_week": 5, "session_minutes": 60, "priority_muscles": ["biceps", "abs"], "limitations": "",
        },
    },
    {
        "key": "advanced_strength_6d",
        "profile": {
            "name": "Chris", "sex": "male", "age": 31, "height_cm": 185, "weight_kg": 92,
            "experience": "over_2_years", "trained_recently": True, "goal": "strength",
            "days_per_week": 6, "session_minutes": 75, "priority_muscles": [], "limitations": "",
        },
    },
    {
        "key": "short_sessions_knee",
        "profile": {
            "name": "Dana", "sex": "female", "age": 58, "height_cm": 162, "weight_kg": 70,
            "experience": "under_6_months", "trained_recently": False, "goal": "health",
            "days_per_week": 2, "session_minutes": 30, "priority_muscles": [], "limitations": "Knee pain when squatting deep, no jumping",
        },
    },
    {
        "key": "tone_4d",
        "profile": {
            "name": "Eli", "sex": "male", "age": 24, "height_cm": 175, "weight_kg": 70,
            "experience": "6_to_24_months", "trained_recently": False, "goal": "tone",
            "days_per_week": 4, "session_minutes": 50, "priority_muscles": ["chest", "side_delts"], "limitations": "",
        },
    },
]

PUSH_MUSCLES = ("chest", "front_delts", "triceps")
PULL_MUSCLES = ("lats", "upper_back", "rear_delts", "biceps")
KNEE_HEAVY_PATTERNS = ("squat", "lunge", "jump", "plyometric")

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "problems": {"type": "array", "items": {"type": "string"}},
        "fixes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["score", "strengths", "problems", "fixes"],
}

_state = {"running": False, "started": None, "progress": "", "error": ""}
_state_lock = threading.Lock()


def _generate(plan, report):
    feedback = ""
    chosen = {}
    attempts = []
    for attempt in range(2):
        started = time.time()
        try:
            answer = ai.write_first_program(report, feedback)
        except ValueError:
            attempts.append({"ok": False, "problems": ["answer was not valid JSON"], "seconds": round(time.time() - started, 1)})
            feedback = "The answer was not valid JSON."
            continue
        chosen, problems = onboarding._validate(plan, answer)
        attempts.append({"ok": not problems, "problems": problems[:20], "seconds": round(time.time() - started, 1), "summary": (answer.get("summary") or "").strip()})
        if not problems:
            break
        feedback = "; ".join(problems[:20])
    before = {key: dict(value.get("picks", {})) for key, value in chosen.items()}
    chosen = onboarding._fill_gaps(plan, chosen)
    gaps = sum(len(chosen[key]["picks"]) - len(before.get(key, {})) for key in chosen)
    return chosen, attempts, gaps


def _program_rows(plan, chosen, library):
    by_id = {exercise["id"]: exercise for exercise in library}
    days = []
    for day in plan["days"]:
        entry = chosen.get(day["key"], {"picks": {}, "cardio": None, "name": "", "note": ""})
        items = []
        for slot in day["slots"]:
            exercise_id = entry["picks"].get(slot["slot"])
            exercise = by_id.get(exercise_id)
            if exercise:
                items.append({"slot": slot, "exercise": exercise})
        cardio = by_id.get(entry.get("cardio")) if entry.get("cardio") else None
        days.append({"day": day, "name": entry.get("name") or day.get("name_hint", ""), "note": entry.get("note", ""), "items": items, "cardio": cardio})
    return days


def _checks(plan, days, equipment):
    results = []

    def add(name, passed, detail, weight="error"):
        results.append({"check": name, "passed": bool(passed), "detail": detail, "level": weight})

    weekly = {}
    for day in days:
        for item in day["items"]:
            exercise, sets = item["exercise"], item["slot"]["sets"]
            weekly[exercise["primary_muscle"]] = weekly.get(exercise["primary_muscle"], 0) + sets
            for muscle in exercise.get("secondary_muscles") or []:
                weekly[muscle] = weekly.get(muscle, 0) + sets * 0.5

    low, high = [], []
    for muscle in planner.DIRECT_VOLUME_MUSCLES:
        target = plan["weekly_targets"].get(muscle)
        if not target:
            continue
        actual = weekly.get(muscle, 0)
        if actual < target * 0.6:
            low.append(muscle + " " + format(actual, "g") + "/" + str(target))
        elif actual > target * 1.5:
            high.append(muscle + " " + format(actual, "g") + "/" + str(target))
    add("weekly sets per muscle not far below target", not low, ", ".join(low) or "ok")
    add("weekly sets per muscle not far above target", not high, ", ".join(high) or "ok", "warning")

    missed_priority = [muscle + " " + format(weekly.get(muscle, 0), "g") + "/" + str(plan["weekly_targets"].get(muscle))
                       for muscle in plan["priority"] if weekly.get(muscle, 0) < plan["weekly_targets"].get(muscle, 0) * 0.85]
    add("priority muscles reach their target", not missed_priority, ", ".join(missed_priority) or "ok")

    missing_equipment = sorted({item["exercise"]["name"] for day in days for item in day["items"]
                                if not engine.available_exercise(item["exercise"], equipment)})
    add("only owned and available equipment", not missing_equipment, ", ".join(missing_equipment) or "ok")

    max_difficulty = {"beginner": 2, "intermediate": 3, "advanced": 3}[plan["level"]]
    age = plan["profile"].get("age")
    if age and age >= 55:
        max_difficulty = min(max_difficulty, 2)
    too_hard = sorted({item["exercise"]["name"] for day in days for item in day["items"] if item["exercise"]["difficulty"] > max_difficulty})
    add("difficulty fits level and age", not too_hard, ", ".join(too_hard) or "ok")

    duplicates = []
    for day in days:
        names = [item["exercise"]["name"] for item in day["items"]]
        duplicates += [day["day"]["key"] + ": " + name for name in set(names) if names.count(name) > 1]
    add("no exercise twice on one day", not duplicates, ", ".join(duplicates) or "ok")

    minutes = plan["profile"].get("session_minutes") or 60
    long_days = []
    for day in days:
        seconds = sum(item["slot"]["sets"] * (45 + item["slot"]["rest"]) for item in day["items"])
        total = seconds / 60 + (day["day"].get("finisher_minutes") or 0) + 5
        if total > minutes * 1.15:
            long_days.append(day["day"]["key"] + " " + str(round(total)) + " of " + str(minutes) + " min")
    add("sessions fit the available time", not long_days, ", ".join(long_days) or "ok")

    cardio_ok = plan["planned_cardio"] >= plan["cardio_week"] * 0.8 or plan["cardio_week"] == 0
    add("cardio minutes reach the goal", cardio_ok, str(plan["planned_cardio"]) + " of " + str(plan["cardio_week"]) + " min per week", "warning")

    missing_cardio = [day["day"]["key"] for day in days if day["day"]["cardio_candidates"] and not day["cardio"]]
    add("every cardio block has an exercise", not missing_cardio, ", ".join(missing_cardio) or "ok")

    push = sum(weekly.get(muscle, 0) for muscle in PUSH_MUSCLES)
    pull = sum(weekly.get(muscle, 0) for muscle in PULL_MUSCLES)
    ratio = push / pull if pull else 99
    add("push and pull are balanced", 0.6 <= ratio <= 1.6, "push " + format(push, "g") + ", pull " + format(pull, "g"), "warning")

    if "knee" in (plan["profile"].get("limitations") or "").lower():
        risky = sorted({item["exercise"]["name"] for day in days for item in day["items"]
                        if any(word in (item["exercise"].get("pattern") or "") for word in KNEE_HEAVY_PATTERNS) and item["exercise"]["difficulty"] >= 2})
        add("knee limitation respected", not risky, ", ".join(risky) or "ok", "warning")

    return results, weekly


def _program_text(plan, days):
    lines = ["Person: " + json.dumps(plan["profile"]), "Level: " + plan["level"] + ", split: " + plan["split"], ""]
    for day in days:
        lines.append(planner.WEEKDAY_NAMES[day["day"]["weekday"]] + " | " + (day["name"] or day["day"]["key"]))
        for item in day["items"]:
            slot = item["slot"]
            lines.append("  " + item["exercise"]["name"] + ": " + str(slot["sets"]) + " x " + str(slot["rep_min"]) + " to " + str(slot["rep_max"]) + ", rest " + str(slot["rest"]) + " s")
        if day["cardio"]:
            lines.append("  Cardio: " + day["cardio"]["name"] + " " + str(day["day"].get("finisher_minutes") or 0) + " min")
    return "\n".join(lines)


def _judge(plan, days):
    prompt = (
        "You review a weekly training program that an app generated for a home gym member. Be strict and specific, like an "
        "experienced coach checking a colleague's work. Judge exercise choice, weekly volume per muscle, balance, fit to the "
        "person's goal, level, age, time and limitations, and whether a real person could follow it. Score 1 to 10, where 7 means "
        "solid and safe, 9 means excellent. List at most 4 strengths, at most 6 concrete problems and at most 6 concrete fixes.\n\n"
        + _program_text(plan, days)
    )
    return ai.chat_json(prompt, JUDGE_SCHEMA, timeout=180)


def run_persona(persona, library, equipment, judge=True):
    plan = planner.build_plan(persona["profile"], library, equipment)
    report = planner.write_report(plan, equipment)
    started = time.time()
    chosen, attempts, gaps = _generate(plan, report)
    days = _program_rows(plan, chosen, library)
    checks, weekly = _checks(plan, days, equipment)
    review = None
    if judge:
        try:
            review = _judge(plan, days)
        except Exception as error:
            review = {"score": None, "strengths": [], "problems": ["judge failed: " + str(error)[:200]], "fixes": []}
    return {
        "persona": persona["key"],
        "profile": persona["profile"],
        "level": plan["level"],
        "split": plan["split"],
        "seconds": round(time.time() - started, 1),
        "attempts": attempts,
        "first_try_valid": bool(attempts and attempts[0]["ok"]),
        "gaps_filled": gaps,
        "checks": checks,
        "errors": sum(1 for check in checks if not check["passed"] and check["level"] == "error"),
        "warnings": sum(1 for check in checks if not check["passed"] and check["level"] == "warning"),
        "weekly_sets": {key: round(value, 1) for key, value in sorted(weekly.items())},
        "targets": plan["weekly_targets"],
        "program": _program_text(plan, days),
        "review": review,
    }


def run_all(judge=True, only=None):
    state = ai.status(max_age=0)
    if not state["ready"]:
        raise RuntimeError("AI is not ready: " + ai.describe(state))
    library = engine.library_exercises()
    equipment = db.equipment_map()
    results = []
    for persona in PERSONAS:
        if only and persona["key"] not in only:
            continue
        with _state_lock:
            _state["progress"] = persona["key"]
        try:
            results.append(run_persona(persona, library, equipment, judge))
        except Exception as error:
            results.append({"persona": persona["key"], "crashed": str(error)[:400], "errors": 1, "warnings": 0, "checks": [], "attempts": []})
    scores = [item["review"]["score"] for item in results if item.get("review") and isinstance(item["review"].get("score"), int)]
    summary = {
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": ai.config()["model"],
        "personas": len(results),
        "first_try_valid": sum(1 for item in results if item.get("first_try_valid")),
        "errors": sum(item.get("errors", 0) for item in results),
        "warnings": sum(item.get("warnings", 0) for item in results),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
    }
    data = {"summary": summary, "results": results}
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    (REPORT_DIR / ("report-" + stamp + ".json")).write_text(json.dumps(data, indent=2, ensure_ascii=False))
    (REPORT_DIR / ("report-" + stamp + ".md")).write_text(to_markdown(data))
    (REPORT_DIR / "latest.json").write_text(json.dumps(data, indent=2, ensure_ascii=False))
    return data


def to_markdown(data):
    summary = data["summary"]
    lines = [
        "# Program quality report",
        "",
        "Time: " + summary["time"] + "  ",
        "Model: " + str(summary["model"]) + "  ",
        "Personas: " + str(summary["personas"]) + ", valid on first try: " + str(summary["first_try_valid"]) + "  ",
        "Rule errors: " + str(summary["errors"]) + ", warnings: " + str(summary["warnings"]) + "  ",
        "Average coach score: " + str(summary["average_score"]),
        "",
    ]
    for item in data["results"]:
        lines.append("## " + item["persona"])
        if item.get("crashed"):
            lines += ["", "Crashed: " + item["crashed"], ""]
            continue
        lines.append("")
        lines.append("Level " + item["level"] + ", split " + item["split"] + ", " + str(item["seconds"]) + " s, gaps filled by rules: " + str(item["gaps_filled"]))
        for number, attempt in enumerate(item["attempts"], 1):
            lines.append("* Attempt " + str(number) + ": " + ("valid" if attempt["ok"] else "invalid, " + "; ".join(attempt["problems"][:5])))
        lines += ["", "| Check | Result | Detail |", "|---|---|---|"]
        for check in item["checks"]:
            result = "pass" if check["passed"] else ("FAIL" if check["level"] == "error" else "warn")
            lines.append("| " + check["check"] + " | " + result + " | " + check["detail"] + " |")
        review = item.get("review")
        if review:
            lines += ["", "Coach score: " + str(review.get("score"))]
            for title, key in (("Strengths", "strengths"), ("Problems", "problems"), ("Fixes", "fixes")):
                if review.get(key):
                    lines.append("")
                    lines.append(title + ":")
                    lines += ["* " + text for text in review[key]]
        lines += ["", "```", item["program"], "```", ""]
    return "\n".join(lines)


def latest():
    path = REPORT_DIR / "latest.json"
    data = json.loads(path.read_text()) if path.exists() else None
    with _state_lock:
        state = dict(_state)
    return {"state": state, "report": data}


def start_async(judge=True):
    with _state_lock:
        if _state["running"]:
            return False
        _state.update({"running": True, "started": time.strftime("%Y-%m-%d %H:%M:%S"), "progress": "starting", "error": ""})

    def worker():
        try:
            run_all(judge=judge)
        except Exception as error:
            with _state_lock:
                _state["error"] = str(error)[:400]
        finally:
            with _state_lock:
                _state["running"] = False
                _state["progress"] = ""

    threading.Thread(target=worker, daemon=True).start()
    return True


if __name__ == "__main__":
    arguments = sys.argv[1:]
    use_judge = "--no-judge" not in arguments
    selected = [value for value in arguments if not value.startswith("--")]
    output = run_all(judge=use_judge, only=selected or None)
    print(to_markdown(output))
    print("errors", output["summary"]["errors"], "warnings", output["summary"]["warnings"], "score", output["summary"]["average_score"])

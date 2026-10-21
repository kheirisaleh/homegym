import json
import threading

import ai
import architect
import db
import engine
import planner

_running = set()
_running_lock = threading.Lock()


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
        "session_minutes": user["session_minutes"],
        "priority_muscles": json.loads(user["priority_muscles"] or "[]"),
        "limitations": user["limitations"] or "",
    }


def _set_status(user_id, status, message=""):
    with db.transaction() as conn:
        conn.execute("UPDATE users SET status = ?, status_message = ? WHERE id = ?", (status, message, user_id))


def _validate(plan, answer):
    days = {day["key"]: day for day in plan["days"]}
    problems = []
    chosen = {}
    for entry in answer.get("days", []):
        day = days.get(entry.get("day_key"))
        if not day:
            problems.append("unknown day_key " + str(entry.get("day_key")))
            continue
        picks = {}
        for choice in entry.get("choices", []):
            slot = next((slot for slot in day["slots"] if slot["slot"] == choice.get("slot")), None)
            if not slot:
                problems.append(day["key"] + ": unknown slot " + str(choice.get("slot")))
                continue
            allowed = {exercise["id"]: exercise for exercise in slot["candidates"]}
            if choice.get("exercise_id") not in allowed:
                problems.append(day["key"] + "/" + slot["slot"] + ": id " + str(choice.get("exercise_id")) + " is not a candidate")
                continue
            if choice["exercise_id"] in picks.values():
                problems.append(day["key"] + "/" + slot["slot"] + ": exercise already used on this day")
                continue
            picks[slot["slot"]] = choice["exercise_id"]
        cardio = entry.get("cardio_exercise_id")
        cardio_ok = cardio in {exercise["id"] for exercise in day["cardio_candidates"]}
        if day["cardio_candidates"] and not cardio_ok:
            problems.append(day["key"] + ": cardio id " + str(cardio) + " is not a candidate")
        chosen[day["key"]] = {
            "name": (entry.get("name") or "").strip()[:40],
            "note": (entry.get("note") or "").strip()[:300],
            "picks": picks,
            "cardio": cardio if cardio_ok else None,
        }
    for key, day in days.items():
        missing = [slot["slot"] for slot in day["slots"] if slot["slot"] not in chosen.get(key, {}).get("picks", {})]
        if missing:
            problems.append(key + ": no choice for " + ", ".join(missing))
    return chosen, problems


def _fill_gaps(plan, chosen):
    for day in plan["days"]:
        entry = chosen.setdefault(day["key"], {"name": "", "note": "", "picks": {}, "cardio": None})
        used = set(entry["picks"].values())
        for slot in day["slots"]:
            if slot["slot"] not in entry["picks"]:
                fallback = next((exercise["id"] for exercise in slot["candidates"] if exercise["id"] not in used), slot["candidates"][0]["id"])
                entry["picks"][slot["slot"]] = fallback
                used.add(fallback)
        if day["cardio_candidates"] and not entry["cardio"]:
            entry["cardio"] = day["cardio_candidates"][0]["id"]
        if not entry["name"]:
            entry["name"] = day["name_hint"]
    return chosen


def generate(user_id):
    with _running_lock:
        if user_id in _running:
            return
        _running.add(user_id)
    try:
        with db.as_user(user_id):
            _generate(user_id)
    except engine.AIUnavailable as error:
        _set_status(user_id, "waiting_ai", "Waiting for the AI coach: " + str(error))
    except Exception as error:
        _set_status(user_id, "failed", "Program generation failed: " + str(error)[:300])
    finally:
        with _running_lock:
            _running.discard(user_id)


def _generate(user_id):
    user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not user:
        return
    _set_status(user_id, "generating", "Building your training brief")
    engine.require_ai()
    try:
        result = architect.design_program(user_id, {}, progress=lambda message: _set_status(user_id, "generating", message))
        architect.apply_design(user_id, result, kind="first")
        return
    except engine.AIUnavailable:
        raise
    except Exception as error:
        print("architect failed, using the classic planner:", error, flush=True)
    profile = profile_of(user)
    equipment = db.equipment_map()
    library = engine.library_exercises()
    plan = planner.build_plan(profile, library, equipment)
    report = planner.write_report(plan, equipment)
    with db.transaction() as conn:
        conn.execute("UPDATE users SET report = ? WHERE id = ?", (report, user_id))

    engine.require_ai()
    _set_status(user_id, "generating", "The AI coach is writing your first program")
    feedback = ""
    chosen = {}
    summary = ""
    for attempt in range(2):
        try:
            answer = ai.write_first_program(report, feedback)
        except ValueError:
            feedback = "The answer was not valid JSON."
            continue
        except Exception as error:
            raise engine.AIUnavailable(str(error)[:400])
        chosen, problems = _validate(plan, answer)
        summary = (answer.get("summary") or "").strip()
        if not problems:
            break
        feedback = "; ".join(problems[:20])
    chosen = _fill_gaps(plan, chosen)
    _apply(user_id, plan, chosen, summary, report)


def _apply(user_id, plan, chosen, summary, report):
    exercises = {exercise["id"]: exercise for exercise in engine.library_exercises()}
    block = engine.ensure_block()
    with db.transaction() as conn:
        conn.execute("UPDATE programs SET archived = 1 WHERE user_id = ? AND archived = 0", (user_id,))
        for day in plan["days"]:
            entry = chosen[day["key"]]
            program_id = conn.execute(
                "INSERT INTO programs (user_id, name, weekday, description, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, entry["name"], day["weekday"], entry["note"], db.now_iso()),
            ).lastrowid
            position = 0
            for slot in day["slots"]:
                exercise = exercises[entry["picks"][slot["slot"]]]
                rep_min, rep_max = slot["rep_min"], slot["rep_max"]
                if exercise["measure"] == "sec":
                    rep_min, rep_max = 20, 45
                conn.execute(
                    """
                    INSERT INTO program_exercises (program_id, exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, added_block)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (program_id, exercise["id"], position, slot["sets"], db.build_target(rep_min, rep_max, exercise["measure"]), slot["rest"],
                     rep_min, rep_max, block["number"]),
                )
                position += 1
            if entry.get("cardio") and day["finisher_minutes"]:
                minutes = day["finisher_minutes"]
                conn.execute(
                    """
                    INSERT INTO program_exercises (program_id, exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, added_block)
                    VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?)
                    """,
                    (program_id, entry["cardio"], position, db.build_target(minutes, minutes, "min"), minutes, minutes, block["number"]),
                )
        db.set_user_setting(conn, "priority_muscles", json.dumps(plan["priority"]), user_id)
        db.set_user_setting(conn, "goal_fat_loss", "1" if plan["fat_loss"] else "0", user_id)
        db.set_user_setting(conn, "cardio_target_min", plan["cardio_week"], user_id)
        db.set_user_setting(conn, "block_weeks", 6 if plan["level"] == "beginner" else 5, user_id)
        conn.execute("UPDATE users SET status = 'ready', status_message = '', plan_summary = ? WHERE id = ?", (summary, user_id))
        db.log_event(conn, "manual", "first_program", "First program written by the AI coach",
                     (summary or "Your first program is ready.") + "\n\nSplit: " + plan["split"] + ". Level: " + plan["level"] + ".",
                     block_id=block["id"], source="ai")


def retry_waiting():
    users = db.query_all("SELECT id, rebuild_request FROM users WHERE status IN ('waiting_ai', 'generating')")
    for user in users:
        if user["rebuild_request"]:
            if not architect.is_running(user["id"]):
                try:
                    request = json.loads(user["rebuild_request"])
                except ValueError:
                    request = {}
                architect.run_rebuild(user["id"], request)
            continue
        if user["id"] not in _running:
            generate(user["id"])


def start_async(user_id):
    threading.Thread(target=generate, args=(user_id,), daemon=True).start()

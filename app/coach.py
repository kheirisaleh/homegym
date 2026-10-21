import json
import threading
import time
from datetime import date, datetime, timedelta

import ai
import db
import engine
import nutrition

PERSONAS = {
    "max": {
        "key": "max", "name": "Max", "sex": "male", "title": "Strength coach", "color": "#d93a3f",
        "style": "You are Max, a calm, direct and energetic strength coach in his thirties. You speak like a real gym coach standing next to the person: "
                 "short sentences, practical, a little humor, never cheesy. You notice details in the log and praise real effort, not fake hype.",
    },
    "lena": {
        "key": "lena", "name": "Lena", "sex": "female", "title": "Performance coach", "color": "#3f7bf2",
        "style": "You are Lena, a warm, precise and motivating performance coach in her thirties. You speak like a real coach on the gym floor: "
                 "clear technique focus, encouraging but honest, short sentences, a touch of humor. You praise specific progress, not fake hype.",
    },
}

VOICE = {
    "max": {
        "hello": ["Alright {name}, let's get to work.", "{name}, good to see you. Let's make this one count.", "Here we go, {name}."],
        "back": "Welcome back after {days} days, let's ease into it with clean reps.",
        "streak": "Second day in a row, I like the rhythm.",
        "deload": "Lighter week: fewer sets, same weights, crisp technique. Recovery is part of the plan.",
        "first": "Start with {exercise}: {plan}.",
        "beat": "Last time you did {last}. Beat that by one rep or keep it with better control.",
        "up": "Heads up: {exercise} goes up to {weight} kg today.",
        "new": "{exercise} is new for you, pick a weight that leaves two reps in the tank.",
        "weak": "On {exercise}, slow the way down and squeeze hard, last time you didn't feel it.",
        "pain": "Careful with {exercise}, it hurt last time. Stop it if the joint complains.",
        "rest": "Rest fully on the big lifts, rush only the small stuff.",
        "log": "Log every set right after you finish it.",
        "done_title": ["Job done", "Strong session", "That's how it's done"],
        "done": "Good work on {program}: {sets} in {minutes}.",
        "records": "New bests on {list}. That's real progress.",
        "next": "Next time the app raises {list}.",
        "missing": "{list} got skipped today, let's hit it next time.",
        "recover": ["Get a protein rich meal in the next hours.", "Sleep 7 to 9 hours tonight, that's where you grow.", "Drink water and walk a bit tomorrow."],
    },
    "lena": {
        "hello": ["Hi {name}, ready? Let's make every rep count.", "Hey {name}, good to have you here today.", "{name}, let's do this together."],
        "back": "{days} days since your last session, so we start smooth and focus on technique.",
        "streak": "Back again today, your consistency is paying off.",
        "deload": "This is a recovery week: fewer sets, same weights, perfect form.",
        "first": "We open with {exercise}: {plan}.",
        "beat": "Last time: {last}. Aim for one more rep, or the same with smoother control.",
        "up": "Nice, {exercise} moves up to {weight} kg today.",
        "new": "{exercise} is new: choose a weight where you could still do two more reps.",
        "weak": "For {exercise}, lower slowly and pause in the stretch, you said you didn't feel it.",
        "pain": "Listen to your body on {exercise}, it hurt last time. Stop if it pinches.",
        "rest": "Take your full rest on the heavy sets, quality first.",
        "log": "Log each set as soon as it's done.",
        "done_title": ["Beautiful work", "Great session", "Well done"],
        "done": "You finished {program}: {sets} in {minutes}.",
        "records": "New personal bests on {list}. I'm proud of that.",
        "next": "For next time the app increases {list}.",
        "missing": "{list} didn't happen today, we'll catch it next time.",
        "recover": ["Have a protein rich meal soon.", "Aim for 7 to 9 hours of sleep tonight.", "A short walk tomorrow helps recovery."],
    },
}

MESSAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "message": {"type": "string"},
        "points": {"type": "array", "items": {"type": "string"}},
        "mood": {"type": "string"},
    },
    "required": ["title", "message", "points", "mood"],
}

FAST_MODEL = "gemini-flash-lite-latest"
_inflight = set()
_inflight_guard = threading.Lock()
_backoff = {"until": 0.0}


def persona_for(user):
    key = (user or {}).get("coach") or ("lena" if (user or {}).get("sex") == "female" else "max")
    return PERSONAS.get(key, PERSONAS["max"])


def persona_public(persona):
    return {"coach": persona["key"], "name": persona["name"], "title": persona["title"], "color": persona["color"], "sex": persona["sex"]}


def _pick(options, seed):
    return options[seed % len(options)]


def _cached(user_id, kind, ref):
    row = db.query_one("SELECT * FROM coach_messages WHERE user_id = ? AND kind = ? AND ref = ?", (user_id, kind, ref))
    if not row:
        return None
    row["points"] = json.loads(row["points"] or "[]")
    return row


def _store(user_id, kind, ref, persona, payload, source):
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO coach_messages (user_id, kind, ref, coach, title, message, points, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, kind, ref) DO UPDATE SET coach = excluded.coach, title = excluded.title, message = excluded.message,
              points = excluded.points, source = excluded.source, created_at = excluded.created_at
            """,
            (user_id, kind, ref, persona["key"], payload["title"][:120], payload["message"][:900], json.dumps(payload["points"][:4]), source, db.now_iso()),
        )
    return _cached(user_id, kind, ref)


def _clean(result):
    points = [str(point).strip()[:160] for point in (result.get("points") or []) if str(point).strip()][:3]
    return {
        "title": str(result.get("title") or "").strip()[:80] or "Let's go",
        "message": str(result.get("message") or "").strip()[:700],
        "points": points,
        "mood": str(result.get("mood") or "focused").strip()[:20],
    }


def _sets_of(entry_id):
    return [item for item in db.query_all("SELECT value, weight, effort FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number", (entry_id,))
            if item["value"] is not None]


def _sets_text(sets, measure="reps"):
    if not sets:
        return "skipped"
    unit = {"sec": " s", "min": " min"}.get(measure, "")
    return ", ".join((engine.fmt(item["weight"]) + " kg x " if item["weight"] else "") + engine.fmt(item["value"]) + unit for item in sets)


def _plan_text(item):
    if item["measure"] == "min":
        return item["target"] or ""
    text = str(item["sets"]) + " sets of " + (item["target"] or "")
    if item.get("target_weight") and item.get("track_weight"):
        text += " at " + engine.fmt(item["target_weight"]) + " kg"
    return text


def _program(user_id, program_id):
    program = db.query_one("SELECT * FROM programs WHERE id = ? AND user_id = ?", (program_id, user_id))
    if not program:
        return None
    program["items"] = db.query_all(
        """
        SELECT pe.*, e.name, e.measure, e.track_weight, e.id AS exercise_id FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id
        WHERE pe.program_id = ? ORDER BY pe.position
        """,
        (program_id,),
    )
    return program


def _feedback(user_id, exercise_ids, since_days=35):
    if not exercise_ids:
        return []
    marks = ",".join("?" for _ in exercise_ids)
    since = (date.today() - timedelta(days=since_days)).isoformat()
    return db.query_all(
        "SELECT f.exercise_id, e.name, f.rating, f.note, f.created_at FROM exercise_feedback f JOIN exercises e ON e.id = f.exercise_id "
        "WHERE f.user_id = ? AND f.exercise_id IN (" + marks + ") AND f.created_at >= ? ORDER BY f.id DESC",
        (user_id, *exercise_ids, since),
    )


def brief_facts(user, program, day):
    user_id = user["id"]
    facts = {"program": program, "day": day, "last": None, "last_by_exercise": {}, "days_since": None, "yesterday": False, "deload": False, "feedback": []}
    with db.as_user(user_id):
        block = engine.ensure_block(day)
        state = engine.block_state(block, day)
        facts["deload"] = bool(state and state["deload"])
    previous = db.query_one("SELECT day FROM sessions WHERE user_id = ? AND status = 'done' AND day < ? ORDER BY day DESC LIMIT 1", (user_id, day))
    if previous:
        facts["days_since"] = (date.fromisoformat(day) - date.fromisoformat(previous["day"])).days
        facts["yesterday"] = facts["days_since"] == 1
    if program:
        last = db.query_one(
            "SELECT id, day, notes FROM sessions WHERE user_id = ? AND program_id = ? AND status = 'done' AND day < ? ORDER BY day DESC, id DESC LIMIT 1",
            (user_id, program["id"], day),
        )
        facts["last"] = last
        for item in program["items"]:
            entry = db.query_one(
                """
                SELECT se.id, se.measure, s.day FROM session_exercises se JOIN sessions s ON s.id = se.session_id
                WHERE s.user_id = ? AND s.status = 'done' AND se.exercise_id = ? AND s.day < ? ORDER BY s.day DESC, s.id DESC LIMIT 1
                """,
                (user_id, item["exercise_id"], day),
            )
            if entry:
                sets = _sets_of(entry["id"])
                if sets:
                    facts["last_by_exercise"][item["exercise_id"]] = {"day": entry["day"], "sets": sets, "measure": entry["measure"]}
        facts["feedback"] = _feedback(user_id, [item["exercise_id"] for item in program["items"]])
    return facts


def rule_brief(user, persona, facts):
    voice = VOICE[persona["key"]]
    program = facts["program"]
    seed = date.fromisoformat(facts["day"]).toordinal()
    name = user["name"]
    sentences = [_pick(voice["hello"], seed).format(name=name)]
    points = []
    if facts["deload"]:
        sentences.append(voice["deload"])
    elif facts["days_since"] and facts["days_since"] >= 4:
        sentences.append(voice["back"].format(days=facts["days_since"]))
    elif facts["yesterday"]:
        sentences.append(voice["streak"])
    title = program["name"] if program else "Free workout"
    if program and program["items"]:
        strength = [item for item in program["items"] if item["measure"] in ("reps", "sec")] or program["items"]
        first = strength[0]
        sentences.append(voice["first"].format(exercise=first["name"], plan=_plan_text(first)))
        last = facts["last_by_exercise"].get(first["exercise_id"])
        if last:
            sentences.append(voice["beat"].format(last=_sets_text(last["sets"][:4], last["measure"])))
        elif first.get("track_weight"):
            sentences.append(voice["new"].format(exercise=first["name"]))
        for item in strength:
            info = facts["last_by_exercise"].get(item["exercise_id"])
            if not info or not item.get("target_weight") or not item.get("track_weight"):
                continue
            top = max((point["weight"] or 0) for point in info["sets"])
            if top and item["target_weight"] > top + 1e-6:
                points.append(voice["up"].format(exercise=item["name"], weight=engine.fmt(item["target_weight"])))
                break
        seen = set()
        for row in facts["feedback"]:
            if row["exercise_id"] in seen or len(points) >= 3:
                continue
            seen.add(row["exercise_id"])
            if row["rating"] == "pain":
                points.append(voice["pain"].format(exercise=row["name"]))
            elif row["rating"] == "weak":
                points.append(voice["weak"].format(exercise=row["name"]))
        cue_item = next((item for item in strength if item.get("cue")), None)
        if cue_item and len(points) < 3:
            points.append(cue_item["name"] + ": " + cue_item["cue"])
    if len(points) < 2:
        points.append(voice["rest"])
    if len(points) < 3:
        points.append(voice["log"])
    mood = "easy" if facts["deload"] else "push" if any("goes up" in point or "moves up" in point for point in points) else "focused"
    return {"title": title, "message": " ".join(sentences), "points": points[:3], "mood": mood}


def _ai_allowed():
    return time.time() >= _backoff["until"]


def _note_ai_error(error):
    text = str(error)
    if " 429" in text:
        _backoff["until"] = time.time() + 15 * 60
    elif " 503" in text or "not reachable" in text or "timed out" in text:
        _backoff["until"] = time.time() + 3 * 60


def _ai_message(prompt, persona, timeout):
    if not _ai_allowed():
        raise RuntimeError("AI is resting after a quota or load error")
    try:
        return _clean(ai.chat_json(prompt, MESSAGE_SCHEMA, timeout=timeout, system=ai.expert_system_prompt(persona["style"]),
                                   temperature=0.6, model=FAST_MODEL))
    except Exception as error:
        _note_ai_error(error)
        raise


def _brief_prompt(user, facts):
    program = facts["program"]
    lines = ["Person: " + user["name"] + ", " + user["sex"] + (", " + str(user["age"]) + " years" if user["age"] else "") + ". Goal: " + str(user["goal"]) + "."]
    lines.append("Day of the workout: " + date.fromisoformat(facts["day"]).strftime("%A") + " " + facts["day"] + ".")
    if facts["deload"]:
        lines.append("This is a deload week: fewer sets, same weights.")
    if facts["days_since"] is not None:
        lines.append("Days since the last workout of any kind: " + str(facts["days_since"]) + ".")
    if program:
        lines.append("Workout: " + program["name"] + ". " + (program["description"] or ""))
        for item in program["items"]:
            line = "  " + item["name"] + ": " + _plan_text(item)
            last = facts["last_by_exercise"].get(item["exercise_id"])
            if last:
                line += ". Last time (" + last["day"] + "): " + _sets_text(last["sets"], last["measure"])
            if item.get("cue"):
                line += ". Cue: " + item["cue"]
            lines.append(line)
        labels = {"good": "felt it well", "weak": "did not feel the target muscle", "pain": "pain or discomfort"}
        for row in facts["feedback"][:6]:
            lines.append("Feedback " + row["created_at"][:10] + " " + row["name"] + ": " + labels.get(row["rating"], row["rating"]) + (" (" + row["note"][:100] + ")" if row["note"] else ""))
    lines.extend(nutrition.prompt_lines(user["id"], short=True))
    return "\n".join([
        "Task: the person is about to start this workout. Brief them as their coach for this exact session.",
        "title: 2 to 5 words. message: 2 to 3 short spoken sentences about what matters most today and why. "
        "points: 2 or 3 concrete do or do not tips for today (each under 14 words). mood: focused, push, easy or celebrate.",
        "Mention at least one concrete fact from last time when given. Copy every number exactly as written, including decimals and units. Never invent numbers.",
        "Sound like a real person, use contractions.",
        "",
        "\n".join(lines),
    ])


def _generate_brief_ai(user_id, program_id, day):
    key = ("brief", user_id, program_id, day)
    with _inflight_guard:
        if key in _inflight:
            return
        _inflight.add(key)
    try:
        user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
        if not user:
            return
        persona = persona_for(user)
        program = _program(user_id, program_id) if program_id else None
        facts = brief_facts(user, program, day)
        result = _ai_message(_brief_prompt(user, facts), persona, timeout=40)
        if result["message"]:
            _store(user_id, "brief", str(program_id or "free") + ":" + day, persona, result, "ai")
    except Exception as error:
        print("coach brief AI skipped:", str(error)[:160], flush=True)
    finally:
        with _inflight_guard:
            _inflight.discard(key)


def brief(user_id, program_id, day, force=False, background=True):
    user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    persona = persona_for(user)
    ref = str(program_id or "free") + ":" + day
    cached = _cached(user_id, "brief", ref)
    if cached and cached["coach"] == persona["key"] and cached["source"] == "ai" and not force:
        return cached
    program = _program(user_id, program_id) if program_id else None
    result = rule_brief(user, persona, brief_facts(user, program, day))
    stored = _store(user_id, "brief", ref, persona, result, "rule")
    if background:
        threading.Thread(target=_generate_brief_ai, args=(user_id, program_id, day), daemon=True).start()
    return stored


def next_program(user_id, day):
    weekday = date.fromisoformat(day).weekday()
    programs = db.query_all("SELECT id, weekday FROM programs WHERE user_id = ? AND archived = 0 AND weekday IS NOT NULL ORDER BY weekday", (user_id,))
    if not programs:
        return None, day
    done_today = db.query_one("SELECT program_id FROM sessions WHERE user_id = ? AND day = ? AND status = 'done' ORDER BY id DESC LIMIT 1", (user_id, day))
    for offset in range(0, 8):
        target = (weekday + offset) % 7
        for program in programs:
            if program["weekday"] != target:
                continue
            if offset == 0 and done_today and done_today["program_id"] == program["id"]:
                continue
            return program["id"], (date.fromisoformat(day) + timedelta(days=offset)).isoformat()
    return None, day


def prepare_upcoming(user_id):
    today = date.today().isoformat()
    program_id, day = next_program(user_id, today)
    if not program_id:
        return
    cached = _cached(user_id, "brief", str(program_id) + ":" + day)
    user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if cached and cached["source"] == "ai" and cached["coach"] == persona_for(user)["key"]:
        return
    _generate_brief_ai(user_id, program_id, day)


def prepare_worker():
    time.sleep(60)
    while True:
        try:
            for user in db.query_all("SELECT id FROM users WHERE status = 'ready'"):
                if not _ai_allowed():
                    break
                prepare_upcoming(user["id"])
                time.sleep(20)
        except Exception as error:
            print("coach prepare error:", error, flush=True)
        time.sleep(30 * 60)


def outro_facts(user_id, session_id):
    session = db.query_one("SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
    if not session:
        return None
    facts = {"session": session, "entries": [], "records": [], "skipped": [], "changes": [], "sets": 0, "minutes": None}
    try:
        facts["minutes"] = round((datetime.fromisoformat(session["finished_at"]) - datetime.fromisoformat(session["started_at"])).total_seconds() / 60)
    except (TypeError, ValueError):
        pass
    with db.as_user(user_id):
        for entry in db.query_all("SELECT * FROM session_exercises WHERE session_id = ? ORDER BY position", (session_id,)):
            sets = _sets_of(entry["id"])
            facts["sets"] += len(sets) if entry["measure"] in ("reps", "sec") else 0
            record = {"name": entry["exercise_name"], "target": entry["target"], "sets": sets, "measure": entry["measure"], "previous": []}
            if not sets:
                facts["skipped"].append(entry["exercise_name"])
            elif entry["exercise_id"]:
                history = [point for point in engine.exercise_exposures(entry["exercise_id"], end=session["day"]) if point["session_id"] != session_id]
                today_points = [point for point in engine.exercise_exposures(entry["exercise_id"], start=session["day"]) if point["session_id"] == session_id]
                record["previous"] = history[-3:]
                if history and today_points and today_points[0]["metric"] > max(point["metric"] for point in history) + 1e-6:
                    facts["records"].append(entry["exercise_name"])
            facts["entries"].append(record)
    facts["changes"] = [row["title"] for row in db.query_all(
        "SELECT title FROM coach_log WHERE user_id = ? AND level = 'session' AND created_at >= ? AND kind IN ('weight_up','reps_up','time_up') ORDER BY id",
        (user_id, session["finished_at"] or session["started_at"]))]
    return facts


def rule_outro(user, persona, facts):
    voice = VOICE[persona["key"]]
    session = facts["session"]
    seed = session["id"]
    minutes = facts["minutes"]
    if minutes is None:
        minutes_text = "a few minutes"
    elif minutes < 1:
        minutes_text = "under a minute"
    else:
        minutes_text = str(minutes) + (" minute" if minutes == 1 else " minutes")
    sets_text = str(facts["sets"]) + (" set" if facts["sets"] == 1 else " sets")
    sentences = [voice["done"].format(program=session["program_name"], sets=sets_text, minutes=minutes_text)]
    if facts["records"]:
        sentences.append(voice["records"].format(list=", ".join(facts["records"][:3])))
    if facts["changes"]:
        names = [change.split(":")[0] for change in facts["changes"]]
        sentences.append(voice["next"].format(list=", ".join(names[:3])))
    if facts["skipped"]:
        sentences.append(voice["missing"].format(list=", ".join(facts["skipped"][:2])))
    points = list(voice["recover"][:2])
    upcoming, day = next_program(user["id"], session["day"])
    if upcoming:
        program = db.query_one("SELECT name FROM programs WHERE id = ?", (upcoming,))
        if program:
            points.append("Next: " + program["name"] + " on " + date.fromisoformat(day).strftime("%A") + ".")
    return {"title": _pick(voice["done_title"], seed), "message": " ".join(sentences), "points": points[:3],
            "mood": "celebrate" if facts["records"] or not facts["skipped"] else "focused"}


def _outro_prompt(user, facts):
    session = facts["session"]
    lines = ["Person: " + user["name"] + ", " + user["sex"] + ". Workout finished: " + session["program_name"] + " on " + session["day"] + "."]
    if facts["minutes"] is not None:
        lines.append("Duration: " + str(facts["minutes"]) + " minutes.")
    for record in facts["entries"]:
        line = "  " + record["name"] + " (target " + (record["target"] or "free") + "): " + _sets_text(record["sets"], record["measure"])
        if record["previous"]:
            line += " | previous best values " + ", ".join(engine.fmt(round(point["metric"], 1)) for point in record["previous"])
        lines.append(line)
    if facts["records"]:
        lines.append("New personal bests today: " + ", ".join(facts["records"]))
    if facts["changes"]:
        lines.append("Automatic changes for next time: " + "; ".join(facts["changes"]))
    if session["notes"]:
        lines.append("Their note: " + session["notes"][:300])
    return "\n".join([
        "Task: the person just finished this workout. As their coach, debrief them on the finish screen.",
        "Name what went well (records, completed targets) and one honest thing to improve. Mention increases the app made for next time.",
        "title: 2 to 5 words. message: 2 to 3 short spoken sentences. points: 2 or 3 concrete tips for recovery or next session (each under 14 words). "
        "mood: celebrate if there were records or all targets were hit, otherwise focused.",
        "Copy every number exactly as written, including decimals and units. Never invent numbers. Sound like a real person, use contractions.",
        "",
        "\n".join(lines),
    ])


def _generate_outro_ai(user_id, session_id):
    key = ("outro", user_id, session_id)
    with _inflight_guard:
        if key in _inflight:
            return
        _inflight.add(key)
    try:
        user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
        persona = persona_for(user)
        facts = outro_facts(user_id, session_id)
        if not facts:
            return
        result = _ai_message(_outro_prompt(user, facts), persona, timeout=30)
        if result["message"]:
            _store(user_id, "outro", str(session_id), persona, result, "ai")
    except Exception as error:
        print("coach outro AI skipped:", str(error)[:160], flush=True)
    finally:
        with _inflight_guard:
            _inflight.discard(key)
        try:
            prepare_upcoming(user_id)
        except Exception:
            pass


def start_outro(user_id, session_id):
    threading.Thread(target=_generate_outro_ai, args=(user_id, session_id), daemon=True).start()


def outro(user_id, session_id, wait=0.0):
    user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    persona = persona_for(user)
    ref = str(session_id)
    deadline = time.time() + max(0.0, min(wait, 8.0))
    while True:
        cached = _cached(user_id, "outro", ref)
        if cached and cached["source"] == "ai" and cached["coach"] == persona["key"]:
            return cached
        with _inflight_guard:
            running = ("outro", user_id, session_id) in _inflight
        if not running or time.time() >= deadline:
            break
        time.sleep(0.4)
    if cached and cached["coach"] == persona["key"]:
        return cached
    facts = outro_facts(user_id, session_id)
    if not facts:
        return None
    return _store(user_id, "outro", ref, persona, rule_outro(user, persona, facts), "rule")


def rest_tip(user_id, session_exercise_id):
    entry = db.query_one(
        """
        SELECT se.*, pe.cue AS plan_cue, e.cues FROM session_exercises se JOIN sessions s ON s.id = se.session_id
        LEFT JOIN program_exercises pe ON pe.id = se.program_exercise_id LEFT JOIN exercises e ON e.id = se.exercise_id
        WHERE se.id = ? AND s.user_id = ?
        """,
        (session_exercise_id, user_id),
    )
    if not entry:
        return None
    user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    persona = persona_for(user)
    sets = _sets_of(entry["id"])
    tips = []
    if sets:
        last = sets[-1]
        if entry["rep_max"] and last["value"] is not None and entry["measure"] == "reps":
            if last["value"] >= entry["rep_max"]:
                tips.append("Top of the range on that set. If the next one feels the same, the weight goes up next time.")
            elif entry["rep_min"] and last["value"] < entry["rep_min"]:
                tips.append("Below the range. Keep the weight but take the full rest, or drop one step if form slipped.")
            else:
                tips.append("Inside the range, good. Same weight, chase one more rep.")
        if last.get("effort") == 1:
            tips.append("That felt easy: next set, push closer to failure.")
        elif last.get("effort") == 3:
            tips.append("Max effort is great on the last set, earlier sets can leave one or two reps.")
    cue = entry.get("plan_cue") or entry.get("cues")
    if cue:
        tips.append(cue)
    tips.append("Breathe slowly, shake out the working muscle.")
    return {"persona": persona_public(persona), "tips": tips[:2]}

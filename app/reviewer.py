import json
import time
from datetime import date, datetime, timedelta

import ai
import config
import db
import engine
import exercise_notes
import nutrition

REVIEW_WEEKDAYS = {2, 6}
REVIEW_HOURS = range(2, 5)
LOOKBACK_DAYS = 35
MAX_CHANGES = 3

DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer"},
                    "action": {"type": "string"},
                    "exercise_id": {"type": "integer"},
                    "sets": {"type": "integer"},
                    "rep_min": {"type": "integer"},
                    "rep_max": {"type": "integer"},
                    "cue": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["item_id", "action", "exercise_id", "sets", "rep_min", "rep_max", "cue", "reason"],
            },
        },
        "note": {"type": "string"},
    },
    "required": ["decisions", "note"],
}


def _signals(user_id, item, equipment, since):
    rows = db.query_all(
        """
        SELECT se.id, s.day FROM session_exercises se JOIN sessions s ON s.id = se.session_id
        WHERE s.user_id = ? AND s.status = 'done' AND se.exercise_id = ? AND s.day >= ? ORDER BY s.day
        """,
        (user_id, item["exercise_id"], since),
    )
    skipped = 0
    for row in rows:
        count = db.query_one("SELECT COUNT(*) AS n FROM session_sets WHERE session_exercise_id = ? AND value IS NOT NULL", (row["id"],))["n"]
        if count == 0:
            skipped += 1
    feedback = {"good": 0, "weak": 0, "pain": 0}
    notes = []
    for row in db.query_all("SELECT rating, note FROM exercise_feedback WHERE user_id = ? AND exercise_id = ? AND created_at >= ?", (user_id, item["exercise_id"], since)):
        feedback[row["rating"]] = feedback.get(row["rating"], 0) + 1
        if row["note"]:
            notes.append(row["note"][:100])
    exposures = [point for point in engine.exercise_exposures(item["exercise_id"], start=since) if not point["deload"]]
    stall = False
    if len(exposures) >= 4:
        last = [point["metric"] for point in exposures[-3:]]
        before = max(point["metric"] for point in exposures[:-3])
        stall = max(last) <= before + 1e-6
    ceiling = False
    limit = None
    key = item.get("load_equipment")
    if key and key in equipment and equipment[key].get("weights"):
        limit = max(equipment[key]["weights"])
    if limit and item["track_weight"] and item.get("target_weight") and item["target_weight"] >= limit - 1e-6 and (item.get("rep_max") or 0) >= 25:
        ceiling = True
    flags = []
    if feedback["pain"]:
        flags.append("reported pain " + str(feedback["pain"]) + " times")
    if feedback["weak"] >= 2:
        flags.append("did not feel the target muscle " + str(feedback["weak"]) + " times")
    if skipped >= 2:
        flags.append("skipped " + str(skipped) + " times")
    if ceiling:
        flags.append("at the heaviest available load with a rep target of " + engine.fmt(item["rep_max"]) + ", too easy")
    if stall:
        flags.append("no progress over the last three workouts")
    return {
        "flags": flags,
        "exposures": len(rows),
        "feedback": feedback,
        "notes": notes,
        "recent": [point["day"] + " best " + engine.fmt(round(point["metric"], 1)) for point in exposures[-4:]],
        "pain": feedback["pain"] > 0,
    }


def review_user(user_id, force=False):
    since = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    with db.as_user(user_id):
        equipment = db.equipment_map()
        block = engine.ensure_block()
        with db.transaction() as conn:
            items = engine._item_rows(conn)
        flagged = []
        for item in items:
            if item["measure"] not in ("reps", "sec"):
                continue
            signals = _signals(user_id, item, equipment, since)
            if not signals["flags"]:
                continue
            if signals["exposures"] < 2 and not signals["pain"]:
                continue
            flagged.append((item, signals))
        if not flagged:
            return {"user_id": user_id, "flagged": 0, "changes": []}
        try:
            engine.require_ai()
        except engine.AIUnavailable:
            return {"user_id": user_id, "flagged": len(flagged), "changes": [], "error": "AI unavailable"}
        user = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
        lines = [
            "Person: " + user["name"] + ", " + user["sex"] + (", " + str(user["age"]) + " years" if user["age"] else "") + ", goal " + str(user["goal"]) +
            ", priority muscles " + ", ".join(json.loads(user["priority_muscles"] or "[]")) + ".",
        ]
        if user["limitations"]:
            lines.append("Limitations in their words: " + user["limitations"][:500])
        lines.extend(nutrition.prompt_lines(user_id))
        lines.append("")
        lines.append("Exercises in the current program that show warning signals:")
        allowed = {}
        with db.transaction() as conn:
            for item, signals in flagged:
                notes = exercise_notes.lookup(item["name"])
                lines.append("* item_id=" + str(item["id"]) + " " + item["name"] + " in '" + item["program_name"] + "': " + str(item["sets"]) + " sets " + (item["target"] or "") +
                             (" at " + engine.fmt(item["target_weight"]) + " kg" if item["target_weight"] else "") +
                             ". Signals: " + "; ".join(signals["flags"]) + ". Recent: " + (", ".join(signals["recent"]) or "none") +
                             (". Their notes: " + "; ".join(signals["notes"]) if signals["notes"] else "") +
                             (". Exercise notes: " + notes["note"] if notes else ""))
                candidates = engine.swap_candidates(conn, item, equipment, block["number"], harder="too easy" in " ".join(signals["flags"]), limit=6)
                allowed[item["id"]] = {candidate["id"] for candidate in candidates}
                for candidate in candidates:
                    info = exercise_notes.lookup(candidate["name"])
                    lines.append("    candidate exercise_id=" + str(candidate["id"]) + " " + candidate["name"] + " (" + str(candidate["primary_muscle"]) + ", " + str(candidate["pattern"]) +
                                 ", difficulty " + str(candidate["difficulty"]) + (", " + info["note"] if info else "") + ")")
        prompt = "\n".join([
            "Task: nightly program review. Decide for each listed item: keep, adjust or swap. Follow section 13 of the coaching guide.",
            "* keep: the signal is not strong enough or a cue will fix it (give a better cue).",
            "* adjust: same exercise, new sets or rep range (for example higher reps when at the load limit).",
            "* swap: replace with one candidate exercise_id of that item (only from its candidate list).",
            "Rules: pain means swap or adjust away from the painful pattern. At most " + str(MAX_CHANGES) + " swaps or adjusts in total. Keep what the person likes.",
            "For keep and adjust, exercise_id is the current exercise id or 0. sets, rep_min and rep_max are the new values (or the current ones for keep).",
            "reason: one sentence for the person. note: 2 to 3 sentences for the person summarizing the review.",
            "",
            "\n".join(lines),
        ])
        try:
            answer = ai.chat_json(prompt, DECISION_SCHEMA, timeout=300, system=ai.expert_system_prompt(), temperature=0.2)
        except Exception as error:
            return {"user_id": user_id, "flagged": len(flagged), "changes": [], "error": str(error)[:200]}
        by_id = {item["id"]: item for item, _ in flagged}
        changes = []
        with db.transaction() as conn:
            snapshots = engine.Snapshots(conn, "Automatic review")
            library = {exercise["id"]: exercise for exercise in engine.library_exercises()}
            for decision in answer.get("decisions", []):
                if len(changes) >= MAX_CHANGES:
                    break
                item = by_id.get(decision.get("item_id"))
                if not item:
                    continue
                action = str(decision.get("action", "keep")).lower()
                reason = str(decision.get("reason") or "").strip()[:300]
                cue = str(decision.get("cue") or "").strip()[:160]
                measure = item["measure"]
                rep_min, rep_max = decision.get("rep_min"), decision.get("rep_max")
                sets = decision.get("sets") or item["sets"]
                sets = max(1, min(6, int(sets)))
                if action == "swap":
                    choice = library.get(decision.get("exercise_id"))
                    if not choice or choice["id"] not in allowed.get(item["id"], set()):
                        continue
                    if not rep_min or not rep_max or rep_max - rep_min < 2:
                        rep_min, rep_max = item["rep_min"] or 8, item["rep_max"] or 12
                    rep_min, rep_max = max(3, min(27, int(rep_min))), max(int(rep_min) + 3, min(30, int(rep_max)))
                    version = snapshots.get(item["program_id"])
                    conn.execute(
                        """
                        UPDATE program_exercises SET exercise_id = ?, sets = ?, rep_min = ?, rep_max = ?, target = ?, target_weight = NULL, miss_count = 0, hit_count = 0,
                          added_block = ?, cue = ? WHERE id = ?
                        """,
                        (choice["id"], sets, rep_min, rep_max, db.build_target(rep_min, rep_max, choice["measure"]), block["number"], cue, item["id"]),
                    )
                    db.log_event(conn, "block", "auto_review", item["name"] + " → " + choice["name"], reason, item["program_id"], item["exercise_id"], block["id"], source="ai", version_id=version)
                    changes.append(item["name"] + " → " + choice["name"])
                elif action == "adjust":
                    if not rep_min or not rep_max:
                        continue
                    if measure == "reps":
                        rep_min, rep_max = max(3, min(27, int(rep_min))), max(int(rep_min) + 3, min(30, int(rep_max)))
                    else:
                        rep_min, rep_max = max(10, int(rep_min)), max(int(rep_min) + 5, min(180, int(rep_max)))
                    if rep_min == item["rep_min"] and rep_max == item["rep_max"] and sets == item["sets"]:
                        continue
                    version = snapshots.get(item["program_id"])
                    conn.execute(
                        "UPDATE program_exercises SET sets = ?, rep_min = ?, rep_max = ?, target = ?, hit_count = 0, miss_count = 0, cue = CASE WHEN ? != '' THEN ? ELSE cue END WHERE id = ?",
                        (sets, rep_min, rep_max, db.build_target(rep_min, rep_max, measure), cue, cue, item["id"]),
                    )
                    db.log_event(conn, "block", "auto_review", item["name"] + ": " + str(sets) + " x " + db.build_target(rep_min, rep_max, measure), reason,
                                 item["program_id"], item["exercise_id"], block["id"], source="ai", version_id=version)
                    changes.append(item["name"] + " adjusted")
                elif cue:
                    conn.execute("UPDATE program_exercises SET cue = ? WHERE id = ?", (cue, item["id"]))
            note = str(answer.get("note") or "").strip()
            if changes or note:
                db.log_event(conn, "block", "auto_review_note", "Coach review: " + (str(len(changes)) + " change" + ("s" if len(changes) != 1 else "") if changes else "no changes needed"),
                             note[:800], block_id=block["id"], source="ai")
        return {"user_id": user_id, "flagged": len(flagged), "changes": changes}


def _idle():
    recent = db.query_one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active'")["n"]
    return recent == 0


def due(now=None):
    now = now or datetime.now()
    if now.weekday() not in REVIEW_WEEKDAYS or now.hour not in REVIEW_HOURS:
        return False
    return db.get_setting("auto_review_last") != now.date().isoformat()


def run_all():
    results = []
    for user in db.query_all("SELECT id FROM users WHERE status = 'ready'"):
        try:
            results.append(review_user(user["id"]))
        except Exception as error:
            results.append({"user_id": user["id"], "error": str(error)[:200]})
    with db.transaction() as conn:
        db.set_setting(conn, "auto_review_last", date.today().isoformat())
        db.set_setting(conn, "auto_review_result", json.dumps(results)[:4000])
    return results


def worker():
    time.sleep(30)
    while True:
        try:
            if config.get_bool("auto_review") and due() and _idle():
                print("auto review:", run_all(), flush=True)
        except Exception as error:
            print("auto review error:", error, flush=True)
        time.sleep(900)

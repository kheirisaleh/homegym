import json
import math
from datetime import date, timedelta

import ai
import catalog
import db
import nutrition

MAX_SETS_PER_EXERCISE = 5
MAX_SETS_PER_SESSION = 24
MAX_SWAPS_PER_BLOCK = 2
MAX_ADDED_SETS_PER_BLOCK = 8
STAGNATION_THRESHOLD = 1.01
EARLY_DELOAD_DROP = 0.95
BODYWEIGHT_TOO_EASY_REPS = 20
CARDIO_WEEKLY_CAP = 300
VOLUME_TARGETS = {"normal": (10, 20), "priority": (14, 22)}


def today():
    return date.today()


def monday(day):
    return day - timedelta(days=day.weekday())


def to_date(value):
    return value if isinstance(value, date) else date.fromisoformat(value)


def fmt(value):
    return db.format_number(value)


def e1rm(weight, reps):
    if weight is None or reps is None or weight <= 0 or reps <= 0:
        return None
    return weight * (1 + reps / 30.0)


def load_weights(exercise, equipment):
    key = exercise.get("load_equipment")
    if not key or key not in equipment:
        return None
    return equipment[key]["weights"]


def next_step(weights, current):
    if weights:
        higher = sorted(value for value in weights if value > current + 1e-6)
        if higher:
            return higher[0]
        return None
    return round(current + 2.5, 2)


def previous_step(weights, current):
    if weights:
        lower = sorted((value for value in weights if value < current - 1e-6), reverse=True)
        return lower[0] if lower else None
    value = round(current - 2.5, 2)
    return value if value > 0 else None


def set_metric(measure, track_weight, sets):
    values = []
    for item in sets:
        if item.get("value") is None:
            continue
        if measure == "reps" and track_weight and item.get("weight"):
            estimate = e1rm(item["weight"], item["value"])
            if estimate:
                values.append(estimate)
        else:
            values.append(item["value"])
    return max(values) if values else None


def exercise_exposures(exercise_id, start=None, end=None):
    sql = """
        SELECT se.id, se.measure, se.track_weight, s.day, s.id AS session_id, s.deload, s.cycle_adjusted
        FROM session_exercises se JOIN sessions s ON s.id = se.session_id
        WHERE se.exercise_id = ? AND s.status = 'done' AND s.user_id = ?
    """
    params = [exercise_id, db.uid()]
    if start:
        sql += " AND s.day >= ?"
        params.append(str(start))
    if end:
        sql += " AND s.day < ?"
        params.append(str(end))
    sql += " ORDER BY s.day, s.started_at"
    result = []
    for row in db.query_all(sql, params):
        sets = db.query_all("SELECT set_number, value, weight FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number", (row["id"],))
        metric = set_metric(row["measure"], bool(row["track_weight"]), sets)
        if metric is None:
            continue
        weights = [item["weight"] for item in sets if item["weight"]]
        result.append({
            "day": row["day"],
            "session_id": row["session_id"],
            "metric": metric,
            "top_weight": max(weights) if weights else None,
            "deload": bool(row["deload"] or row["cycle_adjusted"]),
        })
    return result


def settings():
    return {
        "priority": db.get_user_json_setting("priority_muscles", catalog.DEFAULT_PRIORITY_MUSCLES),
        "fat_loss": db.get_user_setting("goal_fat_loss") == "1",
        "block_weeks": max(4, min(6, int(db.get_user_setting("block_weeks") or 5))),
        "cardio_target": int(db.get_user_setting("cardio_target_min") or 150),
    }


def block_end(block):
    return to_date(block["start_day"]) + timedelta(days=7 * block["weeks"])


def block_state(block, day=None):
    if block is None:
        return None
    day = to_date(day or today())
    start = to_date(block["start_day"])
    week = max(1, min(block["weeks"], (day - start).days // 7 + 1))
    deload_from = to_date(block["deload_from"]) if block["deload_from"] else start + timedelta(days=7 * (block["weeks"] - 1))
    return {
        "id": block["id"],
        "number": block["number"],
        "start_day": block["start_day"],
        "end_day": str(block_end(block)),
        "weeks": block["weeks"],
        "week": week,
        "deload": day >= deload_from,
        "deload_from": str(deload_from),
        "early_deload": bool(block["deload_from"]),
        "days_left": max(0, (block_end(block) - day).days),
    }


def active_block():
    return db.query_one("SELECT * FROM blocks WHERE status = 'active' AND user_id = ? ORDER BY id DESC LIMIT 1", (db.uid(),))


def ensure_block(day=None):
    day = to_date(day or today())
    block = active_block()
    if block is None:
        with db.transaction() as conn:
            weeks = settings()["block_weeks"]
            conn.execute(
                "INSERT INTO blocks (user_id, number, start_day, weeks, created_at) VALUES (?, 1, ?, ?, ?)",
                (db.uid(), str(monday(day)), weeks, db.now_iso()),
            )
        return active_block()
    guard = 0
    while block and day >= block_end(block) and guard < 20:
        try:
            review_block(block, forced=False, day=day)
        except AIUnavailable as error:
            note_ai_waiting(block, str(error))
            return block
        block = active_block()
        guard += 1
    return block


def _open_next_block(conn, previous, day):
    end = block_end(previous)
    start = end if (day - end).days < 14 else monday(day)
    weeks = settings()["block_weeks"]
    conn.execute(
        "INSERT INTO blocks (user_id, number, start_day, weeks, created_at) VALUES (?, ?, ?, ?, ?)",
        (db.uid(), previous["number"] + 1, str(start), weeks, db.now_iso()),
    )


class Snapshots:
    def __init__(self, conn, reason):
        self.conn = conn
        self.reason = reason
        self.versions = {}

    def get(self, program_id):
        if program_id not in self.versions:
            self.versions[program_id] = db.snapshot_program(self.conn, program_id, self.reason)
        return self.versions[program_id]


def _item_rows(conn, where="", params=()):
    sql = """
        SELECT pe.*, e.name, e.measure, e.track_weight, e.primary_muscle, e.secondary_muscles, e.pattern, e.equipment,
               e.load_equipment, e.difficulty, p.name AS program_name, p.weekday
        FROM program_exercises pe
        JOIN exercises e ON e.id = pe.exercise_id
        JOIN programs p ON p.id = pe.program_id
        WHERE p.archived = 0 AND p.user_id = ?
    """ + where + " ORDER BY p.id, pe.position"
    rows = []
    for row in conn.execute(sql, (db.uid(), *params)).fetchall():
        item = dict(row)
        item["secondary_muscles"] = json.loads(item["secondary_muscles"] or "[]")
        item["equipment"] = json.loads(item["equipment"] or "[]")
        item["track_weight"] = bool(item["track_weight"])
        rows.append(item)
    return rows


def _write_item_target(conn, item_id, rep_min, rep_max, measure, extra=None):
    fields = {"rep_min": rep_min, "rep_max": rep_max, "target": db.build_target(rep_min, rep_max, measure)}
    if extra:
        fields.update(extra)
    assignments = ", ".join(key + " = ?" for key in fields)
    conn.execute("UPDATE program_exercises SET " + assignments + " WHERE id = ?", (*fields.values(), item_id))


def process_session(session_id):
    session = db.query_one("SELECT * FROM sessions WHERE id = ?", (session_id,))
    if not session or session["status"] != "done" or session["adapted"]:
        return []
    equipment = db.equipment_map()
    changes = []
    with db.transaction() as conn:
        snapshots = Snapshots(conn, "Progression after workout on " + session["day"])
        block_id = session["block_id"]
        entries = conn.execute(
            "SELECT * FROM session_exercises WHERE session_id = ? AND program_exercise_id IS NOT NULL ORDER BY position",
            (session_id,),
        ).fetchall()
        for entry in entries:
            items = _item_rows(conn, " AND pe.id = ?", (entry["program_exercise_id"],))
            if not items:
                continue
            item = items[0]
            if item["exercise_id"] != entry["exercise_id"]:
                continue
            sets = [dict(row) for row in conn.execute(
                "SELECT set_number, value, weight FROM session_sets WHERE session_exercise_id = ? AND value IS NOT NULL ORDER BY set_number",
                (entry["id"],),
            ).fetchall()]
            if not sets or session["deload"] or session.get("cycle_adjusted"):
                continue
            change = _progress_item(conn, item, sets, entry["planned_sets"], equipment, snapshots, block_id)
            if change:
                changes.append(change)
        conn.execute("UPDATE sessions SET adapted = 1 WHERE id = ?", (session_id,))
    check_early_deload(session["day"])
    return changes


def _progress_item(conn, item, sets, planned, equipment, snapshots, block_id):
    measure = item["measure"]
    rep_min, rep_max = item["rep_min"], item["rep_max"]
    name = item["name"]
    weights = load_weights(item, equipment)

    if measure == "reps" and item["track_weight"] and any(entry["weight"] for entry in sets):
        top_weight = max(entry["weight"] or 0 for entry in sets)
        target_weight = item["target_weight"]
        first = sets[0]
        if target_weight is None:
            version = snapshots.get(item["program_id"])
            conn.execute("UPDATE program_exercises SET target_weight = ?, miss_count = 0 WHERE id = ?", (top_weight, item["id"]))
            db.log_event(conn, "session", "weight_set", name + ": starting weight " + fmt(top_weight) + " kg",
                         "First workout with this exercise. The heaviest weight becomes the target.", item["program_id"], item["exercise_id"], block_id, version_id=version)
            return {"exercise": name, "kind": "weight_set", "weight": top_weight}
        at_target = [entry for entry in sets if entry["weight"] and entry["weight"] >= target_weight - 1e-6]
        if rep_max and len(at_target) >= planned and all(entry["value"] >= rep_max for entry in at_target[:planned]):
            new_weight = next_step(weights, max(target_weight, top_weight))
            if new_weight is None:
                if rep_max < 30:
                    version = snapshots.get(item["program_id"])
                    _write_item_target(conn, item["id"], rep_min + 2, rep_max + 2, measure, {"miss_count": 0})
                    db.log_event(conn, "session", "reps_up", name + ": rep target " + db.build_target(rep_min + 2, rep_max + 2, measure),
                                 "You reached the heaviest weight you own, so the rep target goes up instead.", item["program_id"], item["exercise_id"], block_id, version_id=version)
                    return {"exercise": name, "kind": "reps_up"}
                return None
            version = snapshots.get(item["program_id"])
            conn.execute("UPDATE program_exercises SET target_weight = ?, miss_count = 0, hit_count = 0 WHERE id = ?", (new_weight, item["id"]))
            db.log_event(conn, "session", "weight_up", name + ": " + fmt(target_weight) + " → " + fmt(new_weight) + " kg",
                         "All " + str(planned) + " sets at the top of the range (" + fmt(rep_max) + " reps). Next time start with " + fmt(new_weight) + " kg at the bottom of the range.",
                         item["program_id"], item["exercise_id"], block_id, version_id=version)
            return {"exercise": name, "kind": "weight_up", "weight": new_weight}
        if top_weight > target_weight + 1e-6 and rep_min and first["weight"] and first["weight"] >= top_weight - 1e-6 and first["value"] >= rep_min:
            version = snapshots.get(item["program_id"])
            conn.execute("UPDATE program_exercises SET target_weight = ?, miss_count = 0 WHERE id = ?", (top_weight, item["id"]))
            db.log_event(conn, "session", "weight_up", name + ": " + fmt(target_weight) + " → " + fmt(top_weight) + " kg adopted",
                         "You went heavier on your own and still hit the range.", item["program_id"], item["exercise_id"], block_id, version_id=version)
            return {"exercise": name, "kind": "weight_up", "weight": top_weight}
        if rep_min and first["weight"] and first["weight"] >= target_weight - 1e-6 and first["value"] < rep_min:
            misses = item["miss_count"] + 1
            if misses >= 2:
                lower = previous_step(weights, target_weight)
                if lower:
                    version = snapshots.get(item["program_id"])
                    conn.execute("UPDATE program_exercises SET target_weight = ?, miss_count = 0 WHERE id = ?", (lower, item["id"]))
                    db.log_event(conn, "session", "weight_down", name + ": " + fmt(target_weight) + " → " + fmt(lower) + " kg",
                                 "Twice in a row below " + fmt(rep_min) + " reps on the first set. One step back to work cleanly inside the range again.",
                                 item["program_id"], item["exercise_id"], block_id, version_id=version)
                    return {"exercise": name, "kind": "weight_down", "weight": lower}
            conn.execute("UPDATE program_exercises SET miss_count = ? WHERE id = ?", (misses, item["id"]))
            return None
        if item["miss_count"]:
            conn.execute("UPDATE program_exercises SET miss_count = 0 WHERE id = ?", (item["id"],))
        return None

    if measure in ("reps", "sec") and rep_max:
        complete = len(sets) >= planned and all(entry["value"] >= rep_max for entry in sets[:planned])
        if not complete:
            if item["hit_count"]:
                conn.execute("UPDATE program_exercises SET hit_count = 0 WHERE id = ?", (item["id"],))
            return None
        if measure == "sec":
            new_min = 5 * math.ceil(rep_min * 1.1 / 5)
            new_max = 5 * math.ceil(rep_max * 1.1 / 5)
            version = snapshots.get(item["program_id"])
            _write_item_target(conn, item["id"], new_min, new_max, measure)
            db.log_event(conn, "session", "time_up", name + ": target " + db.build_target(new_min, new_max, measure),
                         "All sets at the top of the time target, plus 10 percent.", item["program_id"], item["exercise_id"], block_id, version_id=version)
            return {"exercise": name, "kind": "time_up"}
        hits = item["hit_count"] + 1
        if hits >= 2 and rep_max < 30:
            version = snapshots.get(item["program_id"])
            _write_item_target(conn, item["id"], rep_min + 2, rep_max + 2, measure, {"hit_count": 0})
            db.log_event(conn, "session", "reps_up", name + ": target " + db.build_target(rep_min + 2, rep_max + 2, measure),
                         "Twice in a row all sets at the top of the range. The range moves up by 2 reps.",
                         item["program_id"], item["exercise_id"], block_id, version_id=version)
            return {"exercise": name, "kind": "reps_up"}
        conn.execute("UPDATE program_exercises SET hit_count = ? WHERE id = ?", (hits, item["id"]))
    return None


def _session_metric_ratio(session):
    rows = db.query_all(
        "SELECT exercise_id, measure, track_weight FROM session_exercises WHERE session_id = ? AND exercise_id IS NOT NULL AND measure = 'reps' AND track_weight = 1",
        (session["id"],),
    )
    eligible = 0
    dropped = 0
    for row in rows:
        history = exercise_exposures(row["exercise_id"], end=session["day"])
        history = [entry for entry in history if not entry["deload"] and entry["session_id"] != session["id"]][-3:]
        current = [entry for entry in exercise_exposures(row["exercise_id"], start=session["day"], end=str(to_date(session["day"]) + timedelta(days=1))) if entry["session_id"] == session["id"]]
        if len(history) < 2 or not current:
            continue
        eligible += 1
        average = sum(entry["metric"] for entry in history) / len(history)
        if current[0]["metric"] < average * EARLY_DELOAD_DROP:
            dropped += 1
    return eligible, dropped


def check_early_deload(day):
    block = active_block()
    if not block or block["deload_from"]:
        return False
    state = block_state(block, day)
    if state["deload"] or state["week"] < 3:
        return False
    sessions = db.query_all(
        "SELECT * FROM sessions WHERE status = 'done' AND deload = 0 AND cycle_adjusted = 0 AND block_id = ? AND user_id = ? ORDER BY day DESC, started_at DESC LIMIT 2",
        (block["id"],),
    )
    if len(sessions) < 2:
        return False
    for session in sessions:
        eligible, dropped = _session_metric_ratio(session)
        if eligible < 2 or dropped / eligible <= 0.5:
            return False
    start_deload(reason="In two workouts in a row more than half of the exercises were over 5 percent below your average.", day=day)
    return True


def start_deload(reason, day=None, manual=False):
    block = ensure_block(day)
    state = block_state(block, day)
    if state["deload"]:
        return False
    deload_day = to_date(day or today())
    end = block_end(block)
    with db.transaction() as conn:
        if (end - deload_day).days > 7:
            weeks = max(1, math.ceil(((deload_day + timedelta(days=7)) - to_date(block["start_day"])).days / 7))
            conn.execute("UPDATE blocks SET deload_from = ?, weeks = ? WHERE id = ?", (str(deload_day), weeks, block["id"]))
        else:
            conn.execute("UPDATE blocks SET deload_from = ? WHERE id = ?", (str(deload_day), block["id"]))
        db.log_event(conn, "deload", "deload_start", "Deload starts" + (" (manual)" if manual else " earlier than planned"),
                     reason + " One week with half the sets at the same weight, then a new block starts.",
                     block_id=block["id"], source="manual" if manual else "rule")
    return True


def register_fatigue(day=None):
    block = ensure_block(day)
    state = block_state(block, day)
    if state["deload"]:
        return {"started": False, "message": "You are already in a deload."}
    if state["week"] < 2:
        with db.transaction() as conn:
            db.log_event(conn, "deload", "fatigue", "Fatigue noted",
                         "The block has just started. Check sleep and nutrition. If it continues, report it again from week 2.",
                         block_id=block["id"], source="manual")
        return {"started": False, "message": "Noted. The block is too young for a deload."}
    start_deload("You reported being exhausted.", day=day, manual=True)
    return {"started": True, "message": "Deload started."}


def available_exercise(exercise, equipment):
    return all(key in equipment and equipment[key]["available"] for key in exercise["equipment"])


def library_exercises():
    rows = db.query_all("SELECT * FROM exercises WHERE primary_muscle IS NOT NULL")
    return [db.exercise_row(row) for row in rows]


def recently_removed(conn, block_number, blocks_back=2):
    rows = conn.execute(
        """
        SELECT DISTINCT c.exercise_id FROM coach_log c JOIN blocks b ON b.id = c.block_id
        WHERE c.kind = 'swap' AND c.undone = 0 AND b.number >= ? AND c.user_id = ?
        """,
        (block_number - blocks_back, db.uid()),
    ).fetchall()
    return {row["exercise_id"] for row in rows}


def swap_candidates(conn, item, equipment, block_number, harder=False, limit=6):
    in_program = {row["exercise_id"] for row in conn.execute("SELECT exercise_id FROM program_exercises WHERE program_id = ?", (item["program_id"],)).fetchall()}
    removed = recently_removed(conn, block_number)
    scored = []
    for candidate in library_exercises():
        if candidate["id"] == item["exercise_id"] or candidate["id"] in in_program or candidate["id"] in removed:
            continue
        if candidate["measure"] != item["measure"]:
            continue
        if not available_exercise(candidate, equipment):
            continue
        same_pattern = candidate["pattern"] == item["pattern"]
        same_primary = candidate["primary_muscle"] == item["primary_muscle"]
        same_family = catalog.pattern_family(candidate["pattern"]) is not None and catalog.pattern_family(candidate["pattern"]) == catalog.pattern_family(item["pattern"])
        trains_target = item["primary_muscle"] in candidate["secondary_muscles"]
        if not same_pattern and not same_primary and not (same_family and trains_target):
            continue
        score = 0.0
        score += 3 if same_pattern else 0
        score += 2 if same_primary else 0
        score += 1 if same_family else 0
        score += 0.5 * len(set(candidate["secondary_muscles"]) & set(item["secondary_muscles"]))
        difficulty_gap = candidate["difficulty"] - item["difficulty"]
        if harder:
            if difficulty_gap <= 0 and not candidate["track_weight"]:
                continue
            score += 2 if candidate["track_weight"] else difficulty_gap
        else:
            score -= abs(difficulty_gap) * 0.75
        if candidate.get("media_loop") or candidate.get("video_id"):
            score += 0.25
        scored.append((score, candidate))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["name"]))
    return [candidate for _, candidate in scored[:limit]]


class AIUnavailable(Exception):
    pass


def require_ai():
    state = ai.status()
    if not (state["reachable"] and state["model_installed"]):
        raise AIUnavailable(ai.describe(state))


def swap_item(conn, item, reason, block, equipment, snapshots, harder=False, level="block"):
    candidates = swap_candidates(conn, item, equipment, block["number"], harder=harder)
    if not candidates:
        db.log_event(conn, level, "swap_none", item["name"] + ": no suitable replacement",
                     reason + " There is currently no alternative with your equipment. New equipment or exercises widen the choice.",
                     item["program_id"], item["exercise_id"], block["id"])
        return None
    result = None
    for attempt in range(2):
        try:
            result = ai.choose_swap(item, candidates, {"reason": reason, "priority": settings()["priority"]})
            break
        except ValueError:
            continue
        except Exception as error:
            raise AIUnavailable(str(error))
    if result is None:
        result = {"exercise_id": candidates[0]["id"], "reason": ""}
    choice = next(candidate for candidate in candidates if candidate["id"] == result["exercise_id"])
    why = result.get("reason", "").strip()
    source = "ai"
    version = snapshots.get(item["program_id"])
    rep_min, rep_max = item["rep_min"], item["rep_max"]
    if rep_min is None and choice["measure"] == "reps":
        rep_min, rep_max = 8, 15
    if harder and not choice["track_weight"]:
        rep_min, rep_max = 6, 12
    elif choice["track_weight"] and not item["track_weight"]:
        rep_min, rep_max = 8, 12
    conn.execute(
        """
        UPDATE program_exercises SET exercise_id = ?, rep_min = ?, rep_max = ?, target = ?, target_weight = NULL, miss_count = 0, hit_count = 0, added_block = ?
        WHERE id = ?
        """,
        (choice["id"], rep_min, rep_max, db.build_target(rep_min, rep_max, choice["measure"], item["target"]), block["number"], item["id"]),
    )
    message = reason + " Replacement: " + choice["name"] + "."
    if why:
        message += " " + why
    db.log_event(conn, level, "swap", item["name"] + " → " + choice["name"], message, item["program_id"], item["exercise_id"], block["id"], source=source, version_id=version)
    return choice


def muscle_volume(conn=None):
    if conn is None:
        with db.transaction() as own:
            return muscle_volume(own)
    rows = _item_rows(conn)
    volume = {}
    per_session = {}
    for item in rows:
        if item["measure"] in ("min", "none"):
            continue
        primary = item["primary_muscle"]
        if not primary or primary in catalog.NON_HYPERTROPHY_MUSCLES:
            continue
        volume[primary] = volume.get(primary, 0) + item["sets"]
        for muscle in item["secondary_muscles"]:
            volume[muscle] = volume.get(muscle, 0) + item["sets"] * 0.5
        per_session[item["program_id"]] = per_session.get(item["program_id"], 0) + item["sets"]
    return volume, per_session


def volume_targets(priority):
    targets = {}
    for muscle in catalog.MUSCLES:
        if muscle in catalog.NON_HYPERTROPHY_MUSCLES:
            continue
        targets[muscle] = VOLUME_TARGETS["priority" if muscle in priority else "normal"]
    return targets


def _stagnation(item, block, previous_block, day):
    start = block["start_day"]
    current = [entry for entry in exercise_exposures(item["exercise_id"], start=start, end=str(day + timedelta(days=1))) if not entry["deload"]]
    result = {"exposures": len(current), "stagnant": False, "too_easy": False, "change": None}
    if item["measure"] == "reps" and not item["track_weight"] and item["rep_max"] and item["rep_max"] >= BODYWEIGHT_TOO_EASY_REPS:
        result["too_easy"] = True
    if len(current) < 2 or previous_block is None:
        return result
    previous = [entry for entry in exercise_exposures(item["exercise_id"], start=previous_block["start_day"], end=start) if not entry["deload"]]
    if not previous:
        return result
    best_now = max(entry["metric"] for entry in current)
    best_before = max(entry["metric"] for entry in previous)
    result["change"] = best_now / best_before - 1 if best_before else None
    progressed = db.query_one(
        "SELECT 1 FROM coach_log WHERE exercise_id = ? AND block_id = ? AND kind IN ('weight_up', 'reps_up', 'time_up') AND undone = 0 LIMIT 1",
        (item["exercise_id"], block["id"]),
    )
    if best_now < best_before * STAGNATION_THRESHOLD and not progressed:
        result["stagnant"] = True
    return result


def note_ai_waiting(block, reason):
    recent = db.query_one(
        "SELECT id FROM coach_log WHERE kind = 'ai_waiting' AND block_id = ? AND created_at >= ? LIMIT 1",
        (block["id"], (date.today() - timedelta(days=1)).isoformat()),
    )
    if recent:
        return
    with db.transaction() as conn:
        db.log_event(conn, "block", "ai_waiting", "Block review is waiting for the AI coach",
                     "The block has ended, but the local AI model is not ready (" + reason + "). The review runs automatically as soon as it is back.",
                     block_id=block["id"])


def review_block(block, forced=False, day=None):
    require_ai()
    day = to_date(day or today())
    review_day = min(day, block_end(block) - timedelta(days=1))
    config = settings()
    equipment = db.equipment_map()
    previous_block = db.query_one("SELECT * FROM blocks WHERE number = ? AND user_id = ? ORDER BY id DESC LIMIT 1", (block["number"] - 1, db.uid()))
    summary = []
    with db.transaction() as conn:
        snapshots = Snapshots(conn, "Block review " + str(block["number"]))
        items = _item_rows(conn)

        status = {}
        for item in items:
            if item["measure"] in ("min", "none"):
                continue
            status[item["id"]] = _stagnation(item, block, previous_block, review_day)

        swaps = 0
        swap_order = sorted(
            (item for item in items if item["id"] in status and (status[item["id"]]["stagnant"] or status[item["id"]]["too_easy"])),
            key=lambda item: (0 if status[item["id"]]["too_easy"] else 1, status[item["id"]]["change"] or 0),
        )
        for item in swap_order:
            if swaps >= MAX_SWAPS_PER_BLOCK:
                break
            if item["added_block"] >= block["number"] and not forced:
                continue
            info = status[item["id"]]
            if info["too_easy"]:
                reason = "At " + fmt(item["rep_max"]) + " reps the exercise has become too easy."
            else:
                change = info["change"]
                reason = "No strength gain compared with the last block (" + ("{:+.1f}".format(change * 100)if change is not None else "0") + " percent) and no weight increase."
            if swap_item(conn, item, reason, block, equipment, snapshots, harder=info["too_easy"]):
                swaps += 1
                summary.append("Swapped: " + item["name"])

        stalled_muscles = {item["primary_muscle"] for item in items if item["id"] in status and status[item["id"]]["stagnant"]}
        summary.extend(_adjust_volume(conn, block, config, stalled_muscles, snapshots))

        if config["fat_loss"]:
            line = _adjust_cardio(conn, block, config, snapshots, day)
            if line:
                summary.append(line)

        if not summary:
            summary.append("No structural changes needed. The program continues and weights keep rising through double progression.")
        text = " · ".join(summary)
        try:
            note = ai.block_note(_block_context(conn, block, previous_block, status, items, summary, config))
        except Exception as error:
            raise AIUnavailable("the AI could not write the block review: " + str(error)[:120])
        db.log_event(conn, "block", "block_review", "Block " + str(block["number"]) + " reviewed", text + "\n\n" + note.strip(), block_id=block["id"], source="ai")
        conn.execute("UPDATE blocks SET status = 'done', summary = ?, ended_at = ? WHERE id = ?", (text, db.now_iso(), block["id"]))
        if forced:
            weeks = config["block_weeks"]
            conn.execute(
                "INSERT INTO blocks (user_id, number, start_day, weeks, created_at) VALUES (?, ?, ?, ?, ?)",
                (db.uid(), block["number"] + 1, str(day), weeks, db.now_iso()),
            )
        else:
            _open_next_block(conn, block, day)
    return summary


def _block_context(conn, block, previous_block, status, items, summary, config):
    lines = [
        "Block " + str(block["number"]) + " from " + block["start_day"] + " just ended.",
        "Priority muscles: " + ", ".join(MUSCLE_LABELS.get(muscle, muscle) for muscle in config["priority"]) + ".",
        "Fat loss goal: " + ("yes" if config["fat_loss"] else "no") + ".",
        "Exercise results this block (change of best estimated 1RM or reps versus the previous block):",
    ]
    for item in items:
        info = status.get(item["id"])
        if not info:
            continue
        change = info["change"]
        lines.append("  " + item["name"] + " (" + item["program_name"] + "): " + str(info["exposures"]) + " sessions, " +
                     ("{:+.1f} percent".format(change * 100) if change is not None else "no comparison yet") +
                     (", stalled" if info["stagnant"] else "") + (", too easy" if info["too_easy"] else ""))
    sessions = conn.execute(
        "SELECT COUNT(*) AS n FROM sessions WHERE status = 'done' AND block_id = ?", (block["id"],)
    ).fetchone()["n"]
    lines.append("Workouts completed in this block: " + str(sessions) + ".")
    trend = bodyweight_trend()
    if trend and trend["weekly_rate"] is not None:
        lines.append("Body weight trend: {:+.2f} percent per week.".format(trend["weekly_rate"] * 100))
    lines.extend(nutrition.prompt_lines(db.uid()))
    lines.append("Changes the rules just applied: " + "; ".join(summary))
    return "\n".join(lines)


def session_note(session_id):
    session = db.query_one("SELECT * FROM sessions WHERE id = ?", (session_id,))
    if not session:
        return None
    entries = db.query_all("SELECT * FROM session_exercises WHERE session_id = ? ORDER BY position", (session_id,))
    lines = ["Workout '" + session["program_name"] + "' on " + session["day"] + (" (deload week)" if session["deload"] else "") + "."]
    for entry in entries:
        sets = db.query_all("SELECT set_number, value, weight, effort FROM session_sets WHERE session_exercise_id = ? ORDER BY set_number", (entry["id"],))
        done = ", ".join(
            (fmt(item["weight"]) + " kg x " if item["weight"] else "") + fmt(item["value"]) + (" (" + {1: "easy", 2: "hard", 3: "max effort"}[item["effort"]] + ")" if item["effort"] else "")
            for item in sets if item["value"] is not None
        ) or "skipped"
        history = [point for point in exercise_exposures(entry["exercise_id"], end=session["day"]) if point["session_id"] != session_id][-3:] if entry["exercise_id"] else []
        trend = ", ".join(fmt(round(point["metric"], 1)) for point in history)
        lines.append("  " + entry["exercise_name"] + " target " + (entry["target"] or "free") + ": " + done + (" | previous best values: " + trend if trend else ""))
    changes = db.query_all("SELECT title FROM coach_log WHERE level = 'session' AND user_id = ? AND created_at >= ? AND kind != 'ai_note' ORDER BY id", (db.uid(), session["finished_at"] or session["started_at"]))
    if changes:
        lines.append("Automatic changes for next time: " + "; ".join(change["title"] for change in changes))
    if session["notes"]:
        lines.append("User note: " + session["notes"][:400])
    try:
        text = ai.session_note("\n".join(lines))
    except Exception:
        return None
    with db.transaction() as conn:
        db.log_event(conn, "session", "ai_note", "Coach note: " + session["program_name"] + " on " + session["day"], text.strip(), session["program_id"], None, session["block_id"], source="ai")
    return text


def _adjust_volume(conn, block, config, stalled_muscles, snapshots):
    priority = config["priority"]
    items = [item for item in _item_rows(conn) if item["measure"] not in ("min", "none")]
    volume, per_session = muscle_volume(conn)
    targets = volume_targets(priority)
    lines = []
    budget = MAX_ADDED_SETS_PER_BLOCK
    touched = set()

    def candidates_for(muscle):
        return [item for item in items if item["primary_muscle"] == muscle and item["id"] not in touched]

    plan = []
    for muscle, (low, high) in targets.items():
        current = volume.get(muscle, 0)
        if not candidates_for(muscle):
            continue
        if current < low:
            plan.append((0 if muscle in priority else 1, muscle, min(2, math.ceil(low - current)), "below the minimum of " + str(low)))
        elif muscle in priority and current + 1 <= high:
            plan.append((0, muscle, 1, "priority muscle"))
        elif muscle in stalled_muscles and current < high:
            plan.append((2, muscle, 1, "stalled"))
        elif current > high:
            plan.append((3, muscle, -1, "above the maximum of " + str(high)))
    plan.sort()

    for _, muscle, delta, why in plan:
        if delta > 0 and budget <= 0:
            continue
        remaining = delta
        while remaining != 0:
            options = candidates_for(muscle)
            if remaining > 0:
                options = [item for item in options if item["sets"] < MAX_SETS_PER_EXERCISE and per_session.get(item["program_id"], 0) < MAX_SETS_PER_SESSION]
                options.sort(key=lambda item: (item["sets"], item["position"]))
            else:
                options = [item for item in options if item["sets"] > 2]
                options.sort(key=lambda item: (-item["sets"], -item["position"]))
            if not options:
                break
            item = options[0]
            step = 1 if remaining > 0 else -1
            version = snapshots.get(item["program_id"])
            conn.execute("UPDATE program_exercises SET sets = sets + ? WHERE id = ?", (step, item["id"]))
            item["sets"] += step
            per_session[item["program_id"]] = per_session.get(item["program_id"], 0) + step
            touched.add(item["id"])
            before = volume.get(muscle, 0)
            volume[muscle] = before + step
            title = item["name"] + ": " + str(item["sets"] - step) + " → " + str(item["sets"]) + " sets"
            label = MUSCLE_LABELS.get(muscle, muscle)
            message = label + " " + why + ", weekly volume " + fmt(before) + " → " + fmt(volume[muscle]) + " sets."
            db.log_event(conn, "block", "volume_up" if step > 0 else "volume_down", title, message, item["program_id"], item["exercise_id"], block["id"], version_id=version)
            lines.append((label, step))
            if step > 0:
                budget -= 1
                if budget <= 0:
                    break
            remaining -= step
    totals = {}
    for label, step in lines:
        totals[label] = totals.get(label, 0) + step
    return [label + " " + ("+" if delta > 0 else "") + str(delta) + (" set" if abs(delta) == 1 else " sets") for label, delta in totals.items() if delta]


def bodyweight_trend(day=None):
    day = to_date(day or today())
    rows = db.query_all("SELECT day, weight_kg FROM body_metrics WHERE user_id = ? AND weight_kg IS NOT NULL AND day <= ? ORDER BY day", (db.uid(), str(day)))
    if not rows:
        return None
    recent = [row["weight_kg"] for row in rows if (day - to_date(row["day"])).days < 7]
    older = [row["weight_kg"] for row in rows if 14 <= (day - to_date(row["day"])).days < 21]
    result = {"latest": rows[-1]["weight_kg"], "latest_day": rows[-1]["day"], "avg7": sum(recent) / len(recent) if recent else None, "weekly_rate": None}
    if recent and older:
        older_avg = sum(older) / len(older)
        result["weekly_rate"] = (result["avg7"] / older_avg - 1) / 2
    return result


def _adjust_cardio(conn, block, config, snapshots, day):
    trend = bodyweight_trend(day)
    if not trend or trend["weekly_rate"] is None:
        db.log_event(conn, "block", "fat_loss_hint", "Log your body weight for the fat loss trend",
                     "For the leaner face goal the coach needs at least three weeks of body weight entries.", block_id=block["id"])
        return None
    if trend["weekly_rate"] <= -0.0025:
        return "Weight trend {:.1f} percent per week, cardio stays".format(trend["weekly_rate"] * 100)
    cardio_items = [item for item in _item_rows(conn) if item["measure"] == "min" and item["primary_muscle"] == "cardio" and item["rep_max"]]
    planned = sum(item["rep_max"] * item["sets"] for item in cardio_items)
    if not cardio_items or planned >= CARDIO_WEEKLY_CAP:
        db.log_event(conn, "block", "fat_loss_hint", "Weight stalled, check nutrition",
                     "Cardio is already at a sensible limit. The biggest lever now is a small calorie deficit.", block_id=block["id"])
        return "Weight stalled, nutrition hint"
    for item in cardio_items:
        new_max = 5 * math.ceil(item["rep_max"] * 1.1 / 5)
        new_min = 5 * math.ceil((item["rep_min"] or item["rep_max"]) * 1.1 / 5)
        version = snapshots.get(item["program_id"])
        _write_item_target(conn, item["id"], new_min, new_max, "min")
        db.log_event(conn, "block", "cardio_up", item["name"] + ": " + fmt(item["rep_max"]) + " → " + fmt(new_max) + " min",
                     "Body weight stalled under the fat loss goal. More movement, plus a moderate calorie deficit.",
                     item["program_id"], item["exercise_id"], block["id"], version_id=version)
    return "Cardio plus 10 percent"


def seed_target_weights():
    rows = db.query_all(
        """
        SELECT pe.id, pe.exercise_id FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id JOIN programs p ON p.id = pe.program_id
        WHERE pe.target_weight IS NULL AND e.measure = 'reps' AND e.track_weight = 1 AND p.user_id = ?
        """,
        (db.uid(),),
    )
    with db.transaction() as conn:
        for row in rows:
            history = [entry for entry in exercise_exposures(row["exercise_id"]) if entry["top_weight"] and not entry["deload"]]
            if history:
                conn.execute("UPDATE program_exercises SET target_weight = ? WHERE id = ?", (history[-1]["top_weight"], row["id"]))


def run_pending_progression():
    pending = db.query_all("SELECT id FROM sessions WHERE status = 'done' AND adapted = 0 AND user_id = ? ORDER BY day, started_at", (db.uid(),))
    changes = []
    for row in pending:
        changes.extend(process_session(row["id"]))
    return {"sessions": len(pending), "changes": changes}


def force_review(day=None):
    block = ensure_block(day)
    run_pending_progression()
    return review_block(block, forced=True, day=day)


def fix_unavailable_items():
    equipment = db.equipment_map()
    with db.transaction() as conn:
        affected = [item for item in _item_rows(conn) if any(key not in equipment or not equipment[key]["available"] for key in item["equipment"])]
    if not affected:
        return []
    require_ai()
    block = ensure_block()
    swapped = []
    with db.transaction() as conn:
        snapshots = Snapshots(conn, "Equipment unavailable")
        for item in affected:
            missing = [equipment.get(key, {}).get("name", key) for key in item["equipment"] if key not in equipment or not equipment[key]["available"]]
            choice = swap_item(conn, item, ", ".join(missing) + " is no longer available.", block, equipment, snapshots, level="equipment")
            if choice:
                swapped.append(choice["name"])
    return swapped


def undo(log_id):
    with db.transaction() as conn:
        entry = conn.execute("SELECT * FROM coach_log WHERE id = ? AND user_id = ?", (log_id, db.uid())).fetchone()
        if entry is None or entry["undone"] or entry["version_id"] is None:
            return False
        db.restore_program(conn, entry["version_id"])
        conn.execute("UPDATE coach_log SET undone = 1 WHERE version_id = ?", (entry["version_id"],))
        db.log_event(conn, "manual", "undo", "Undone: " + entry["title"], "Program reset to the state before this change.",
                     entry["program_id"], entry["exercise_id"], entry["block_id"], source="manual")
    return True


def program_context(program_id):
    with db.transaction() as conn:
        rows = _item_rows(conn, " AND pe.program_id = ?", (program_id,))
    result = []
    for item in rows:
        history = exercise_exposures(item["exercise_id"])[-6:]
        result.append({"item": item, "history": history})
    return result


def redesign_program(program_id, instruction=""):
    program = db.query_one("SELECT * FROM programs WHERE id = ? AND user_id = ?", (program_id, db.uid()))
    if not program:
        raise ValueError("Program not found")
    block = ensure_block()
    equipment = db.equipment_map()
    config = settings()
    context = program_context(program_id)
    library = [exercise for exercise in library_exercises() if available_exercise(exercise, equipment)]
    focus = set()
    for entry in context:
        if entry["item"]["primary_muscle"]:
            focus.add(entry["item"]["primary_muscle"])

    require_ai()

    lines = [
        "Task: redesign the training program '" + program["name"] + "'.",
        "User goal: muscle growth, especially " + ", ".join(MUSCLE_LABELS.get(muscle, muscle) for muscle in config["priority"]) +
        (", plus fat loss" if config["fat_loss"] else "") + ".",
        "Current focus of this session: " + ", ".join(sorted(MUSCLE_LABELS.get(muscle, muscle) for muscle in focus)) + ". Keep this focus.",
        "Rules: 4 to 7 exercises. 2 to 5 sets per exercise. At most " + str(MAX_SETS_PER_SESSION) + " sets in total.",
        "Compound exercises first, isolation exercises after. Rep ranges between 5 and 20, rest 45 to 180 seconds.",
        "Keep exercises that still show progress. Replace stalled ones.",
        "Current program with history (value = estimated 1RM in kg, or reps):",
    ]
    for entry in context:
        item = entry["item"]
        trend = ", ".join(fmt(round(point["metric"], 1)) for point in entry["history"]) or "no data yet"
        lines.append("  id=" + str(item["exercise_id"]) + " " + item["name"] + " | " + str(item["sets"]) + " sets | " + item["target"] + " | history: " + trend)
    lines.append("Allowed exercises (use only these ids):")
    for exercise in library:
        if exercise["primary_muscle"] in catalog.NON_HYPERTROPHY_MUSCLES and exercise["primary_muscle"] not in focus:
            continue
        lines.append("  id=" + str(exercise["id"]) + " " + exercise["name"] + " | " + MUSCLE_LABELS.get(exercise["primary_muscle"], "") +
                     " | pattern " + str(exercise["pattern"]) + " | measure " + exercise["measure"])
    if instruction.strip():
        lines.append("Additional wish from the user: " + instruction.strip()[:500])
    result = ai.redesign_program("\n".join(lines))
    items = _validate_redesign(result.get("items", []), {exercise["id"]: exercise for exercise in library})
    if not items:
        raise ValueError("The AI answer did not pass validation")

    previous = {entry["item"]["exercise_id"]: entry["item"] for entry in context}
    with db.transaction() as conn:
        version = db.snapshot_program(conn, program_id, "AI redesign")
        conn.execute("DELETE FROM program_exercises WHERE program_id = ?", (program_id,))
        for position, item in enumerate(items):
            old = previous.get(item["exercise_id"])
            measure = item["exercise"]["measure"]
            conn.execute(
                """
                INSERT INTO program_exercises (program_id, exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, target_weight, added_block)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    program_id, item["exercise_id"], position, item["sets"], db.build_target(item["rep_min"], item["rep_max"], measure),
                    item["rest_seconds"], item["rep_min"], item["rep_max"], old["target_weight"] if old else None,
                    old["added_block"] if old else block["number"],
                ),
            )
        names = ", ".join(item["exercise"]["name"] for item in items)
        db.log_event(conn, "manual", "redesign", program["name"] + " redesigned",
                     (result.get("rationale") or "").strip() + " New order: " + names + ".", program_id, None, block["id"], source="ai", version_id=version)
    return {"source": "ai", "rationale": result.get("rationale", ""), "items": [item["exercise"]["name"] for item in items]}


def _validate_redesign(raw_items, allowed):
    cleaned = []
    seen = set()
    total = 0
    for raw in raw_items:
        exercise = allowed.get(raw.get("exercise_id"))
        if not exercise or exercise["id"] in seen:
            continue
        sets = max(1, min(MAX_SETS_PER_EXERCISE, int(raw.get("sets", 3))))
        if total + sets > MAX_SETS_PER_SESSION:
            break
        rep_min = int(raw.get("rep_min", 8))
        rep_max = int(raw.get("rep_max", 12))
        if exercise["measure"] == "reps":
            rep_min = max(3, min(25, rep_min))
            rep_max = max(rep_min, min(30, rep_max))
        rest = max(30, min(240, int(raw.get("rest_seconds", 90))))
        cleaned.append({"exercise_id": exercise["id"], "exercise": exercise, "sets": sets, "rep_min": rep_min, "rep_max": rep_max, "rest_seconds": rest})
        seen.add(exercise["id"])
        total += sets
    if len(cleaned) < 2:
        return []
    return cleaned[:8]


MUSCLE_LABELS = {
    "chest": "Chest", "front_delts": "Front delts", "side_delts": "Side delts", "rear_delts": "Rear delts",
    "triceps": "Triceps", "biceps": "Biceps", "forearms": "Forearms", "lats": "Lats", "upper_back": "Upper back",
    "lower_back": "Lower back", "abs": "Abs", "obliques": "Obliques", "quads": "Quads", "glutes": "Glutes",
    "hamstrings": "Hamstrings", "calves": "Calves", "cardio": "Cardio", "mobility": "Mobility",
}

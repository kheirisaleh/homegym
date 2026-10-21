import math

import catalog

LEVELS = ("beginner", "intermediate", "advanced")
GOALS = {
    "health": "Health and general fitness",
    "fat_loss": "Fast fat loss",
    "muscle": "Build muscle",
    "strength": "Get stronger",
    "tone": "Tone and shape",
}
EXPERIENCE = {
    "beginner": "Beginner",
    "intermediate": "Intermediate, several months of training",
    "advanced": "Advanced, years of training",
    "none": "Never trained with weights",
    "under_6_months": "Less than 6 months",
    "6_to_24_months": "6 to 24 months",
    "over_2_years": "More than 2 years",
}

WEEKLY_SETS = {"beginner": (8, 12), "intermediate": (12, 16), "advanced": (14, 20)}
CARDIO_MINUTES = {"fat_loss": 250, "tone": 180, "health": 150, "muscle": 90, "strength": 90}
REP_RANGES = {
    "strength": ((4, 6), (8, 12)),
    "muscle": ((6, 10), (10, 15)),
    "tone": ((8, 12), (12, 15)),
    "health": ((8, 12), (12, 15)),
    "fat_loss": ((8, 12), (12, 15)),
}
WEEKDAY_LAYOUT = {
    1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
}
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

MAJOR_MUSCLES = ["chest", "lats", "upper_back", "front_delts", "side_delts", "rear_delts", "biceps", "triceps",
                 "quads", "hamstrings", "glutes", "calves", "abs", "obliques"]
DIRECT_VOLUME_MUSCLES = ["chest", "lats", "upper_back", "side_delts", "biceps", "triceps", "quads", "hamstrings", "glutes", "abs"]


def S(slot_id, muscles, patterns, role):
    return {"slot": slot_id, "muscles": muscles, "patterns": patterns, "role": role}


TEMPLATES = {
    "full_a": ("Full Body A", [
        S("squat", ["quads", "glutes"], ["squat"], "compound"),
        S("press", ["chest"], ["horizontal_push"], "compound"),
        S("row", ["lats", "upper_back"], ["horizontal_pull"], "compound"),
        S("hinge", ["hamstrings", "glutes"], ["hinge"], "compound"),
        S("delts", ["side_delts"], ["lateral_raise"], "isolation"),
        S("arms", ["biceps"], ["elbow_flexion", "elbow_flexion_stretch", "elbow_flexion_neutral"], "isolation"),
        S("core", ["abs"], ["hip_flexion", "core_flexion", "anti_extension"], "isolation"),
    ]),
    "full_b": ("Full Body B", [
        S("lunge", ["quads", "glutes"], ["lunge"], "compound"),
        S("press", ["chest", "front_delts"], ["incline_push", "vertical_push"], "compound"),
        S("pull", ["lats"], ["vertical_pull", "horizontal_pull"], "compound"),
        S("glutes", ["glutes"], ["hinge", "hip_abduction", "squat"], "compound"),
        S("arms", ["triceps"], ["elbow_extension", "elbow_extension_overhead", "dip"], "isolation"),
        S("rear", ["rear_delts", "upper_back"], ["rear_delt"], "isolation"),
        S("core", ["abs", "obliques"], ["anti_extension", "anti_lateral", "rotation", "core_flexion"], "isolation"),
    ]),
    "full_c": ("Full Body C", [
        S("squat", ["quads"], ["squat", "lunge"], "compound"),
        S("press", ["chest"], ["horizontal_push", "dip", "chest_fly"], "compound"),
        S("row", ["upper_back", "lats"], ["horizontal_pull"], "compound"),
        S("hamstrings", ["hamstrings"], ["hinge", "knee_flexion"], "compound"),
        S("delts", ["side_delts"], ["lateral_raise"], "isolation"),
        S("arms", ["biceps"], ["elbow_flexion", "elbow_flexion_neutral", "elbow_flexion_stretch"], "isolation"),
        S("arms2", ["triceps"], ["elbow_extension", "elbow_extension_overhead"], "isolation"),
    ]),
    "upper_a": ("Upper A", [
        S("press", ["chest"], ["horizontal_push"], "compound"),
        S("row", ["upper_back", "lats"], ["horizontal_pull"], "compound"),
        S("ohp", ["front_delts"], ["vertical_push"], "compound"),
        S("pull", ["lats"], ["vertical_pull"], "compound"),
        S("delts", ["side_delts"], ["lateral_raise"], "isolation"),
        S("arms", ["biceps"], ["elbow_flexion", "elbow_flexion_stretch"], "isolation"),
        S("arms2", ["triceps"], ["elbow_extension", "elbow_extension_overhead"], "isolation"),
    ]),
    "upper_b": ("Upper B", [
        S("press", ["chest", "front_delts"], ["incline_push"], "compound"),
        S("pull", ["lats"], ["vertical_pull", "horizontal_pull"], "compound"),
        S("fly", ["chest"], ["chest_fly", "dip"], "isolation"),
        S("rear", ["rear_delts", "upper_back"], ["rear_delt", "horizontal_pull"], "isolation"),
        S("delts", ["side_delts"], ["lateral_raise"], "isolation"),
        S("arms", ["biceps"], ["elbow_flexion_neutral", "elbow_flexion"], "isolation"),
        S("arms2", ["triceps"], ["elbow_extension_overhead", "dip", "elbow_extension"], "isolation"),
    ]),
    "lower_a": ("Lower A", [
        S("squat", ["quads", "glutes"], ["squat"], "compound"),
        S("hinge", ["hamstrings", "glutes"], ["hinge"], "compound"),
        S("lunge", ["quads", "glutes"], ["lunge"], "compound"),
        S("hamstrings", ["hamstrings"], ["knee_flexion", "hinge"], "isolation"),
        S("calves", ["calves"], ["calf"], "isolation"),
        S("core", ["abs"], ["hip_flexion", "core_flexion"], "isolation"),
    ]),
    "lower_b": ("Lower B", [
        S("hinge", ["glutes", "hamstrings"], ["hinge"], "compound"),
        S("squat", ["quads", "glutes"], ["squat", "lunge"], "compound"),
        S("glutes", ["glutes"], ["hip_abduction", "hinge"], "isolation"),
        S("hamstrings", ["hamstrings"], ["knee_flexion", "hinge"], "isolation"),
        S("calves", ["calves"], ["calf"], "isolation"),
        S("core", ["abs", "obliques"], ["anti_extension", "anti_lateral", "rotation"], "isolation"),
    ]),
    "push": ("Push", [
        S("press", ["chest"], ["horizontal_push"], "compound"),
        S("incline", ["chest", "front_delts"], ["incline_push"], "compound"),
        S("ohp", ["front_delts"], ["vertical_push"], "compound"),
        S("fly", ["chest"], ["chest_fly", "dip"], "isolation"),
        S("delts", ["side_delts"], ["lateral_raise"], "isolation"),
        S("arms", ["triceps"], ["elbow_extension", "elbow_extension_overhead"], "isolation"),
    ]),
    "pull": ("Pull", [
        S("pull", ["lats"], ["vertical_pull"], "compound"),
        S("row", ["upper_back", "lats"], ["horizontal_pull"], "compound"),
        S("rear", ["rear_delts", "upper_back"], ["rear_delt"], "isolation"),
        S("arms", ["biceps"], ["elbow_flexion", "elbow_flexion_stretch"], "isolation"),
        S("arms2", ["biceps", "forearms"], ["elbow_flexion_neutral"], "isolation"),
        S("core", ["abs"], ["hip_flexion", "core_flexion"], "isolation"),
    ]),
    "legs": ("Legs", [
        S("squat", ["quads", "glutes"], ["squat"], "compound"),
        S("hinge", ["hamstrings", "glutes"], ["hinge"], "compound"),
        S("lunge", ["quads", "glutes"], ["lunge"], "compound"),
        S("glutes", ["glutes"], ["hip_abduction", "hinge"], "isolation"),
        S("calves", ["calves"], ["calf"], "isolation"),
        S("core", ["abs", "obliques"], ["anti_extension", "anti_lateral", "rotation"], "isolation"),
    ]),
}

PRIORITY_SLOTS = {
    "chest": S("extra_chest", ["chest"], ["chest_fly", "incline_push", "horizontal_push"], "isolation"),
    "biceps": S("extra_biceps", ["biceps"], ["elbow_flexion_stretch", "elbow_flexion", "elbow_flexion_neutral"], "isolation"),
    "triceps": S("extra_triceps", ["triceps"], ["elbow_extension_overhead", "elbow_extension"], "isolation"),
    "side_delts": S("extra_delts", ["side_delts"], ["lateral_raise"], "isolation"),
    "front_delts": S("extra_front", ["front_delts"], ["vertical_push"], "compound"),
    "rear_delts": S("extra_rear", ["rear_delts"], ["rear_delt"], "isolation"),
    "lats": S("extra_lats", ["lats"], ["vertical_pull", "horizontal_pull"], "compound"),
    "upper_back": S("extra_back", ["upper_back"], ["horizontal_pull", "shrug"], "compound"),
    "glutes": S("extra_glutes", ["glutes"], ["hinge", "hip_abduction"], "isolation"),
    "quads": S("extra_quads", ["quads"], ["lunge", "squat"], "compound"),
    "hamstrings": S("extra_hams", ["hamstrings"], ["knee_flexion", "hinge"], "isolation"),
    "calves": S("extra_calves", ["calves"], ["calf"], "isolation"),
    "abs": S("extra_abs", ["abs"], ["core_flexion", "hip_flexion", "anti_extension"], "isolation"),
    "obliques": S("extra_obliques", ["obliques"], ["anti_lateral", "rotation"], "isolation"),
    "forearms": S("extra_forearms", ["forearms"], ["elbow_flexion_neutral"], "isolation"),
}


def derive_level(experience, trained_recently):
    base = {"none": 0, "under_6_months": 0, "6_to_24_months": 1, "over_2_years": 2, "beginner": 0, "intermediate": 1, "advanced": 2}.get(experience, 0)
    if not trained_recently and base > 0:
        base -= 1
    return LEVELS[base]


def bmi_info(height_cm, weight_kg):
    if not height_cm or not weight_kg:
        return None, "unknown"
    value = weight_kg / ((height_cm / 100) ** 2)
    if value < 18.5:
        label = "underweight"
    elif value < 25:
        label = "normal"
    elif value < 30:
        label = "overweight"
    else:
        label = "obese"
    return round(value, 1), label


def choose_split(level, days):
    if days <= 2:
        return "Full body twice a week", [["full_a", "full_b"][index] for index in range(max(1, days))], 0
    if level == "beginner" or days == 3:
        strength = ["full_a", "full_b", "full_c"]
        return ("Full body three times a week" + (" plus cardio days" if days > 3 else ""), strength, max(0, days - 3))
    if days == 4:
        return "Upper and lower split", ["upper_a", "lower_a", "upper_b", "lower_b"], 0
    if days == 5:
        return "Upper, lower, push, pull, legs", ["upper_a", "lower_a", "push", "pull", "legs"], 0
    return "Push, pull, legs twice a week", ["push", "pull", "legs", "push", "pull", "legs"], 0


def candidate_pool(slot, library, equipment, level, age, used_ids):
    max_difficulty = {"beginner": 2, "intermediate": 3, "advanced": 3}[level]
    if age and age >= 55:
        max_difficulty = min(max_difficulty, 2)
    scored = []
    for exercise in library:
        if exercise["measure"] not in ("reps", "sec"):
            continue
        if exercise["pattern"] not in slot["patterns"] or exercise["primary_muscle"] not in slot["muscles"]:
            continue
        if not all(key in equipment and equipment[key]["available"] for key in exercise["equipment"]):
            continue
        if exercise["difficulty"] > max_difficulty:
            continue
        score = 0.0
        score += 3 - slot["patterns"].index(exercise["pattern"])
        score += 2 - slot["muscles"].index(exercise["primary_muscle"])
        if slot["role"] == "compound" and exercise["track_weight"]:
            score += 1.5
        if level == "beginner":
            score -= (exercise["difficulty"] - 1) * 1.0
        if exercise.get("media_loop") or exercise.get("video_id"):
            score += 0.3
        if exercise["id"] in used_ids:
            score -= 5
        scored.append((score, exercise))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["name"]))
    return [exercise for _, exercise in scored[:6]]


def cardio_pool(library, equipment, bmi_label, goal):
    pool = []
    for exercise in library:
        if exercise["primary_muscle"] != "cardio" or exercise["measure"] != "min":
            continue
        if not all(key in equipment and equipment[key]["available"] for key in exercise["equipment"]):
            continue
        if bmi_label == "obese" and exercise["pattern"] == "cardio_interval":
            continue
        pool.append(exercise)
    pool.sort(key=lambda exercise: (exercise["pattern"] != "cardio_steady", exercise["difficulty"], exercise["name"]))
    return pool


def build_plan(profile, library, equipment):
    level = derive_level(profile["experience"], profile["trained_recently"])
    bmi, bmi_label = bmi_info(profile.get("height_cm"), profile.get("weight_kg"))
    goal = profile["goal"] if profile["goal"] in GOALS else "health"
    days = max(1, min(7, int(profile["days_per_week"])))
    minutes = max(20, min(120, int(profile.get("session_minutes") or 60)))
    age = profile.get("age")
    priority = [muscle for muscle in profile.get("priority_muscles", []) if muscle in catalog.MUSCLES and muscle not in catalog.NON_HYPERTROPHY_MUSCLES]

    split_name, strength_keys, cardio_days = choose_split(level, days)
    normal_sets, priority_sets = WEEKLY_SETS[level]
    if goal == "fat_loss":
        normal_sets -= 2
    weekly_targets = {muscle: (priority_sets if muscle in priority else normal_sets) for muscle in MAJOR_MUSCLES}
    weekly_targets["calves"] = min(weekly_targets["calves"], 8) if "calves" not in priority else weekly_targets["calves"]
    weekly_targets["front_delts"] = min(weekly_targets["front_delts"], 6) if "front_delts" not in priority else weekly_targets["front_delts"]
    weekly_targets["rear_delts"] = min(weekly_targets["rear_delts"], 8) if "rear_delts" not in priority else weekly_targets["rear_delts"]
    weekly_targets["obliques"] = min(weekly_targets["obliques"], 6) if "obliques" not in priority else weekly_targets["obliques"]

    compound_range, isolation_range = REP_RANGES[goal]
    if level == "beginner":
        compound_range, isolation_range = (8, 12), (12, 15)
    rest_compound = 180 if goal == "strength" and level != "beginner" else 120
    rest_isolation = 75
    rir = "2 to 3" if level == "beginner" or (age and age >= 55) else "1 to 2"
    if age and age >= 55:
        rest_compound += 30

    cardio_week = CARDIO_MINUTES[goal]
    weekday_slots = WEEKDAY_LAYOUT[days]
    if cardio_days:
        strength_weekdays = [0, 2, 4][: len(strength_keys)]
        cardio_weekdays = [day for day in weekday_slots if day not in strength_weekdays][:cardio_days]
        if len(cardio_weekdays) < cardio_days:
            cardio_weekdays += [day for day in range(7) if day not in strength_weekdays and day not in cardio_weekdays][: cardio_days - len(cardio_weekdays)]
    else:
        strength_weekdays = weekday_slots[: len(strength_keys)]
        cardio_weekdays = []

    finisher = 0
    if cardio_days:
        finisher = 15 if goal == "fat_loss" else 10 if goal == "tone" else 0
        per_cardio_day = min(60, max(20, math.ceil((cardio_week - finisher * len(strength_keys)) / cardio_days / 5) * 5))
    else:
        per_cardio_day = 0
        finisher = min(30, max(10, math.ceil(cardio_week / max(1, len(strength_keys)) / 5) * 5)) if cardio_week else 0
    finisher = min(finisher, max(0, minutes // 3))

    occurrences = {}
    for key in strength_keys:
        for slot in TEMPLATES[key][1]:
            occurrences[slot["muscles"][0]] = occurrences.get(slot["muscles"][0], 0) + 1

    strength_minutes = minutes - finisher - 5
    avg_seconds_per_set = 45 + (rest_compound + rest_isolation) / 2
    session_set_cap = max(8, min(24, int(strength_minutes * 60 / avg_seconds_per_set)))

    used_week = set()
    day_plans = []
    for index, key in enumerate(strength_keys):
        name_hint, template = TEMPLATES[key]
        slots = [dict(slot) for slot in template]
        present = {slot["muscles"][0] for slot in slots}
        for muscle in priority:
            if muscle in PRIORITY_SLOTS and (occurrences.get(muscle, 0) < 2 or muscle not in present):
                extra = dict(PRIORITY_SLOTS[muscle])
                if not any(slot["slot"] == extra["slot"] for slot in slots):
                    slots.append(extra)
                    occurrences[muscle] = occurrences.get(muscle, 0) + 1
        day_plans.append({"key": key, "index": index, "name_hint": name_hint, "weekday": strength_weekdays[index], "kind": "strength", "slots": slots})

    for day in day_plans:
        used_today = set()
        for slot in day["slots"]:
            muscle = slot["muscles"][0]
            frequency = max(1, occurrences.get(muscle, 1))
            target = weekly_targets.get(muscle, normal_sets)
            sets = round(target / frequency)
            slot["sets"] = max(2, min(5 if slot["role"] == "compound" else 4, sets))
            low, high = compound_range if slot["role"] == "compound" else isolation_range
            slot["rep_min"], slot["rep_max"] = low, high
            slot["rest"] = rest_compound if slot["role"] == "compound" else rest_isolation
            slot["priority"] = muscle in priority
            pool = candidate_pool(slot, library, equipment, level, age, used_today | used_week)
            slot["candidates"] = pool
            if pool:
                used_today.add(pool[0]["id"])
        day["slots"] = [slot for slot in day["slots"] if slot["candidates"]]
        total = sum(slot["sets"] for slot in day["slots"])
        while total > session_set_cap:
            reducible = sorted(
                (slot for slot in day["slots"] if slot["sets"] > 2),
                key=lambda slot: (slot["priority"], slot["role"] == "compound", -slot["sets"]),
            )
            if reducible:
                reducible[0]["sets"] -= 1
                total -= 1
                continue
            droppable = [slot for slot in day["slots"] if slot["role"] == "isolation" and not slot["priority"]]
            if not droppable:
                break
            day["slots"].remove(droppable[-1])
            total = sum(slot["sets"] for slot in day["slots"])
        for slot in day["slots"]:
            if slot["candidates"]:
                used_week.add(slot["candidates"][0]["id"])
        day["finisher_minutes"] = finisher

    cardio_candidates = cardio_pool(library, equipment, bmi_label, goal)
    for number, weekday in enumerate(cardio_weekdays):
        day_plans.append({"key": "cardio_" + str(number + 1), "index": len(day_plans), "name_hint": "Cardio and Core" if number % 2 == 0 else "Cardio and Mobility",
                          "weekday": weekday, "kind": "cardio", "slots": [], "finisher_minutes": per_cardio_day})
    for day in day_plans:
        day["cardio_candidates"] = cardio_candidates if day["finisher_minutes"] else []
        if day["kind"] == "cardio":
            core_slot = S("core", ["abs", "obliques"], ["anti_extension", "anti_lateral", "core_flexion", "hip_flexion"], "isolation")
            core_slot.update({"sets": 3, "rep_min": isolation_range[0], "rep_max": isolation_range[1], "rest": 45, "priority": "abs" in priority})
            core_slot["candidates"] = candidate_pool(core_slot, library, equipment, level, age, set())
            if core_slot["candidates"]:
                day["slots"] = [core_slot]
    day_plans.sort(key=lambda day: day["weekday"])

    planned_weekly = {}
    for day in day_plans:
        for slot in day["slots"]:
            if not slot["candidates"]:
                continue
            exercise = slot["candidates"][0]
            planned_weekly[exercise["primary_muscle"]] = planned_weekly.get(exercise["primary_muscle"], 0) + slot["sets"]
            for muscle in exercise["secondary_muscles"]:
                planned_weekly[muscle] = planned_weekly.get(muscle, 0) + slot["sets"] * 0.5
    planned_cardio = sum(day["finisher_minutes"] for day in day_plans if day["cardio_candidates"])

    return {
        "profile": profile,
        "level": level,
        "bmi": bmi,
        "bmi_label": bmi_label,
        "goal": goal,
        "split": split_name,
        "days": day_plans,
        "weekly_targets": weekly_targets,
        "planned_weekly": planned_weekly,
        "cardio_week": cardio_week,
        "planned_cardio": planned_cardio,
        "compound_range": compound_range,
        "isolation_range": isolation_range,
        "rest_compound": rest_compound,
        "rest_isolation": rest_isolation,
        "rir": rir,
        "session_set_cap": session_set_cap,
        "priority": priority,
        "fat_loss": goal in ("fat_loss", "tone"),
    }


def muscle_label(key):
    return {
        "chest": "Chest", "front_delts": "Front delts", "side_delts": "Side delts", "rear_delts": "Rear delts", "triceps": "Triceps",
        "biceps": "Biceps", "forearms": "Forearms", "lats": "Lats", "upper_back": "Upper back", "lower_back": "Lower back", "abs": "Abs",
        "obliques": "Obliques", "quads": "Quads", "glutes": "Glutes", "hamstrings": "Hamstrings", "calves": "Calves",
    }.get(key, key)


def write_report(plan, equipment):
    profile = plan["profile"]
    lines = []
    add = lines.append
    add("# Training brief for " + profile["name"])
    add("")
    add("## Person")
    add("* Sex: " + profile["sex"])
    if profile.get("age"):
        add("* Age: " + str(profile["age"]))
    if profile.get("height_cm") and profile.get("weight_kg"):
        add("* Height and weight: {:.0f} cm, {:.1f} kg".format(profile["height_cm"], profile["weight_kg"]))
        add("* BMI: " + str(plan["bmi"]) + " (" + plan["bmi_label"] + ")")
    add("* Experience: " + EXPERIENCE.get(profile["experience"], profile["experience"]) +
        ("; trained regularly in the last 3 months" if profile["trained_recently"] else "; not trained in the last 3 months"))
    add("* Derived level: " + plan["level"])
    add("* Main goal: " + GOALS[plan["goal"]])
    add("* Target muscles (priority): " + (", ".join(muscle_label(muscle) for muscle in plan["priority"]) or "none chosen"))
    add("* Days per week: " + str(profile["days_per_week"]) + ", minutes per session: " + str(profile.get("session_minutes") or 60))
    if profile.get("limitations"):
        add("* Injuries or limits stated by the person: " + profile["limitations"].strip()[:600])
    add("")
    add("## Evidence based rules applied")
    add("* Split: " + plan["split"] + ". Novices train the whole body 2 to 3 times a week, intermediates 3 to 4 days, advanced 4 to 6 days with splits (ACSM 2009). Every muscle is trained at least twice a week (Schoenfeld 2016).")
    add("* Weekly sets per muscle: " + str(WEEKLY_SETS[plan["level"]][0]) + " for normal muscles, " + str(WEEKLY_SETS[plan["level"]][1]) +
        " for priority muscles" + (" (reduced by 2 for fat loss to fit recovery in a calorie deficit)" if plan["goal"] == "fat_loss" else "") +
        ". More volume grows more muscle with diminishing returns (Pelland 2025).")
    add("* Rep ranges: compound exercises {}-{}, isolation {}-{}. Sets end {} reps before failure.".format(
        plan["compound_range"][0], plan["compound_range"][1], plan["isolation_range"][0], plan["isolation_range"][1], plan["rir"]))
    add("* Rest: compound {} s, isolation {} s.".format(plan["rest_compound"], plan["rest_isolation"]))
    add("* Cardio target: {} minutes per week (WHO 2020: 150 to 300 minutes; more than 250 for meaningful weight loss, ACSM).".format(plan["cardio_week"]))
    add("* At most {} working sets per session to fit the time.".format(plan["session_set_cap"]))
    if plan["bmi_label"] == "obese":
        add("* BMI above 30: joint friendly cardio only, no running intervals.")
    if profile.get("age") and profile["age"] >= 55:
        add("* Age 55 or older: stable exercises, longer rests, more reps in reserve.")
    add("* Women and men gain the same relative muscle from the same training (Roberts 2020, Refalo 2025), so the rules are the same for both sexes.")
    if plan["goal"] in ("fat_loss", "tone"):
        add("* Fat cannot be lost from one spot. Total body fat drops through a moderate calorie deficit; training keeps the muscle.")
    add("")
    add("## Available equipment")
    add(", ".join(item["name"] for item in equipment.values() if item["available"]))
    add("")
    add("## Weekly skeleton")
    for day in plan["days"]:
        add("")
        add("### " + WEEKDAY_NAMES[day["weekday"]] + ", day key " + day["key"] + " (" + day["kind"] + ", suggested name: " + day["name_hint"] + ")")
        for slot in day["slots"]:
            add("* slot `" + slot["slot"] + "` for " + "/".join(muscle_label(muscle) for muscle in slot["muscles"]) + (" PRIORITY" if slot.get("priority") else "") +
                ": " + str(slot["sets"]) + " sets of " + str(slot["rep_min"]) + "-" + str(slot["rep_max"]) + ", rest " + str(slot["rest"]) + " s, role " + slot["role"])
            for exercise in slot["candidates"]:
                add("    * id=" + str(exercise["id"]) + " " + exercise["name"] + " (difficulty " + str(exercise["difficulty"]) + ")")
        if day["cardio_candidates"]:
            add("* cardio block: " + str(day["finisher_minutes"]) + " minutes, choose one of:")
            for exercise in day["cardio_candidates"]:
                add("    * id=" + str(exercise["id"]) + " " + exercise["name"])
    add("")
    add("## Planned weekly sets with the first candidates")
    for muscle in MAJOR_MUSCLES:
        add("* " + muscle_label(muscle) + ": " + str(round(plan["planned_weekly"].get(muscle, 0), 1)) + " (target " + str(plan["weekly_targets"].get(muscle)) + ")")
    add("* Cardio minutes planned: " + str(plan["planned_cardio"]))
    rest = plan["cardio_week"] - plan["planned_cardio"]
    if rest > 0:
        add("* The remaining " + str(rest) + " cardio minutes per week come from brisk daily walks outside the gym (about " + str(math.ceil(rest / 7 / 5) * 5) + " minutes a day). Mention this in the summary.")
    return "\n".join(lines)

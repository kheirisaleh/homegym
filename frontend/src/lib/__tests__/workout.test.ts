import { describe, expect, it } from "vitest";
import type { SessionExercise } from "../types";
import { estimatePreviewMinutes, estimateProgramMinutes, firstIncomplete, isComplete, newProgramItem, programBody, programItemAmount, sessionSetCount, sessionVolume, stepValue, stepWeight, suggested, targetText } from "../workout";

function exercise(overrides: Partial<SessionExercise> = {}): SessionExercise {
  return {
    id: 1, session_id: 1, exercise_id: 1, exercise_name: "Bench Press", measure: "reps", track_weight: true, position: 0, planned_sets: 3, target: "8-12", rest_seconds: 90,
    program_exercise_id: null, rep_min: 8, rep_max: 12, target_weight: null, video_id: null, video_start: null, video_end: null, exercise_notes: null, cues: null,
    media_loop: null, media_muscles: null, primary_muscle: "chest", secondary_muscles: [], load_equipment: null, plan_cue: null, sets: [], previous: null, best: null, weight_steps: null,
    ...overrides,
  };
}

describe("progress through a session", () => {
  it("knows when an exercise is complete", () => {
    expect(isComplete({ planned_sets: 2, sets: [] })).toBe(false);
    expect(isComplete({ planned_sets: 1, sets: [{ id: 1, set_number: 1, value: 5, weight: null, effort: null }] })).toBe(true);
  });

  it("finds the next unfinished exercise and wraps around", () => {
    const done = { planned_sets: 1, sets: [{ id: 1, set_number: 1, value: 5, weight: null, effort: null }] };
    const open = { planned_sets: 1, sets: [] };
    expect(firstIncomplete([done, open, done], 2)).toBe(1);
    expect(firstIncomplete([open, done], 1)).toBe(0);
    expect(firstIncomplete([done, done], 0)).toBe(-1);
  });
});

describe("suggested values", () => {
  it("uses the target weight and the bottom of the range first", () => {
    expect(suggested(exercise({ target_weight: 40 }))).toEqual({ weight: 40, value: 8 });
  });

  it("repeats the last logged set", () => {
    expect(suggested(exercise({ target_weight: 40, sets: [{ id: 1, set_number: 1, value: 11, weight: 42.5, effort: 2 }] }))).toEqual({ weight: 42.5, value: 11 });
  });

  it("falls back to the same set of the previous workout", () => {
    const previous = { day: "2026-10-01", sets: [{ set_number: 1, value: 10, weight: 37.5, effort: null }] };
    expect(suggested(exercise({ previous }))).toEqual({ weight: 37.5, value: 10 });
  });

  it("parses a number from a free target", () => {
    expect(suggested(exercise({ track_weight: false, rep_min: null, target: "about 15" }))).toEqual({ weight: null, value: 15 });
  });
});

describe("weight steps", () => {
  it("moves through owned weights", () => {
    const steps = [2.5, 5, 7.5, 10];
    expect(stepWeight(steps, 5, 1)).toBe(7.5);
    expect(stepWeight(steps, 5, -1)).toBe(2.5);
    expect(stepWeight(steps, 10, 1)).toBe(10);
    expect(stepWeight(steps, 6, -1)).toBe(5);
  });

  it("uses 2.5 kg steps without equipment and never goes negative", () => {
    expect(stepWeight(null, "40", 1)).toBe(42.5);
    expect(stepWeight(null, 1, -1)).toBe(0);
  });

  it("steps seconds by five", () => {
    expect(stepValue("sec")).toBe(5);
    expect(stepValue("reps")).toBe(1);
  });

  it("describes the target", () => {
    expect(targetText(exercise({ target_weight: 40 }))).toBe("3 × 8-12 at 40 kg");
    expect(targetText(exercise({ target: "" }))).toBe("3 × free");
  });
});

describe("programs", () => {
  it("estimates minutes in five minute steps", () => {
    const items = [newProgramItem({ id: 1, name: "Squat", measure: "reps", track_weight: true, primary_muscle: "quads" })];
    expect(estimateProgramMinutes({ items: items.map((item) => ({ ...item, sets: 4 })) })).toBe(10);
    expect(estimateProgramMinutes({ items: [{ ...items[0]!, measure: "min", target: "30 min", sets: 1 }] })).toBe(30);
    expect(estimatePreviewMinutes([{ measure: "reps", rep_min: 8, sets: 3, rest_seconds: 90 }])).toBe(12);
  });

  it("creates sensible defaults for new items", () => {
    expect(newProgramItem({ id: 2, name: "Plank", measure: "sec", track_weight: false, primary_muscle: "abs" })).toMatchObject({ sets: 3, rep_min: 30, rep_max: 45, rest_seconds: 90 });
    expect(newProgramItem({ id: 3, name: "Bike", measure: "min", track_weight: false, primary_muscle: "cardio" })).toMatchObject({ sets: 1, rest_seconds: 0 });
  });

  it("builds a clean request body", () => {
    const body = programBody({ name: "Push", weekday: 0, description: "" }, [{ exercise_id: 1, sets: null, target: "", rep_min: 8, rep_max: 12, target_weight: null, rest_seconds: null }], { weekday: 3 });
    expect(body).toEqual({ name: "Push", weekday: 3, description: "", items: [{ exercise_id: 1, sets: 1, target: "", rep_min: 8, rep_max: 12, target_weight: null, rest_seconds: 0 }] });
  });

  it("describes amounts", () => {
    expect(programItemAmount({ measure: "min", target: "20 min", sets: 1 })).toBe("20 min");
    expect(programItemAmount({ measure: "none", target: "", sets: 2 })).toBe("2 rounds");
    expect(programItemAmount({ measure: "reps", target: "8-12", sets: 3 })).toBe("3 × 8-12");
  });

  it("sums volume and sets", () => {
    const sets = [{ sets: [{ id: 1, set_number: 1, value: 10, weight: 50, effort: null }, { id: 2, set_number: 2, value: 8, weight: null, effort: null }] }];
    expect(sessionVolume(sets)).toBe(500);
    expect(sessionSetCount(sets)).toBe(2);
  });
});

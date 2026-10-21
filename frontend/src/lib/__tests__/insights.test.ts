import { describe, expect, it } from "vitest";
import type { BlockState, Equipment, Exercise, SessionSummary, SettingsField, VolumeRow } from "../types";
import { blockWeeks, calendarDays, changedValues, editorSummary, filterExercises, filterMobileExercises, groupByMonth, groupEquipment, heatmapCells, muscleStripe, planItemAmount, volumeState } from "../insights";
import { toIso } from "../format";

function exercise(id: number, overrides: Partial<Exercise> = {}): Exercise {
  return {
    id, name: "Exercise " + String(id), measure: "reps", track_weight: true, video_id: null, video_start: null, video_end: null, video_title: null, video_source: null, notes: "", cues: "",
    primary_muscle: "chest", secondary_muscles: [], pattern: null, equipment: [], load_equipment: null, difficulty: 1, media_loop: null, media_muscles: null, program_count: 0, times_logged: 0, available: true,
    ...overrides,
  };
}

describe("volume", () => {
  const row = (done: number): VolumeRow => ({ muscle: "chest", label: "Chest", planned: 12, done, min: 10, max: 20, priority: false });
  it("classifies weekly sets against the target range", () => {
    expect(volumeState(row(22))).toBe("over");
    expect(volumeState(row(12))).toBe("good");
    expect(volumeState(row(6))).toBe("low");
    expect(volumeState(row(2))).toBe("far");
  });
});

describe("heatmap", () => {
  it("covers 31 weeks ending on sunday with future days marked", () => {
    const cells = heatmapCells([{ day: "2026-10-20", count: 1, sets: 10, volume: 0 }, { day: "2026-10-19", count: 1, sets: 3, volume: 0 }], new Date(2026, 9, 21));
    expect(cells).toHaveLength(31 * 7);
    expect(cells[0]?.day).toBe("2026-03-23");
    expect(cells.at(-1)?.day).toBe("2026-10-25");
    expect(cells.filter((cell) => cell.future)).toHaveLength(4);
    expect(cells.find((cell) => cell.day === "2026-10-20")?.level).toBe(3);
    expect(cells.find((cell) => cell.day === "2026-10-19")?.level).toBe(1);
  });
});

describe("exercise filters", () => {
  const list = [
    exercise(1, { name: "Squat", primary_muscle: "quads", program_count: 1 }),
    exercise(2, { name: "Bench", media_loop: "x.gif" }),
    exercise(3, { name: "Arnold Press", secondary_muscles: ["triceps"], primary_muscle: "front_delts" }),
  ];

  it("filters by text, muscle and media and puts used exercises first", () => {
    expect(filterExercises(list, { query: "", muscle: "", media: "" }).map((entry) => entry.id)).toEqual([1, 3, 2]);
    expect(filterExercises(list, { query: "", muscle: "triceps", media: "" }).map((entry) => entry.id)).toEqual([3]);
    expect(filterExercises(list, { query: "", muscle: "", media: "none" }).map((entry) => entry.id)).toEqual([1, 3]);
    expect(filterExercises(list, { query: "BEN", muscle: "", media: "" }).map((entry) => entry.id)).toEqual([2]);
    expect(filterExercises(list, { query: "", muscle: "", media: "used" }).map((entry) => entry.id)).toEqual([1]);
  });

  it("matches muscle names on mobile", () => {
    const label = (muscle: string | null) => (muscle === "quads" ? "Front thighs" : muscle ?? "");
    expect(filterMobileExercises(list, "thigh", "all", label).map((entry) => entry.id)).toEqual([1]);
    expect(filterMobileExercises(list, "", "plan", label).map((entry) => entry.id)).toEqual([1]);
    expect(filterMobileExercises(list, "", "nomedia", label).map((entry) => entry.id)).toEqual([1, 3]);
  });
});

describe("calendar", () => {
  it("shows six full weeks starting on monday", () => {
    const days = calendarDays(new Date(2026, 9, 15));
    expect(days).toHaveLength(42);
    expect(toIso(days[0]!)).toBe("2026-09-28");
    expect(toIso(days[41]!)).toBe("2026-11-08");
  });

  it("groups sessions by month keeping order", () => {
    const session = (id: number, day: string) => ({ id, day }) as SessionSummary;
    expect(groupByMonth([session(1, "2026-10-02"), session(2, "2026-10-01"), session(3, "2026-09-30")]).map(([key, list]) => [key, list.map((entry) => entry.id)])).toEqual([
      ["2026-10", [1, 2]],
      ["2026-09", [3]],
    ]);
  });
});

describe("programs", () => {
  it("splits sets per primary muscle for the colour stripe", () => {
    const item = (muscle: string | null, sets: number, measure: Exercise["measure"] = "reps") => ({ primary_muscle: muscle, sets, measure }) as never;
    expect(muscleStripe({ items: [item("chest", 3), item("triceps", 1), item("cardio", 2, "min"), item(null, 4)] })).toEqual([
      { muscle: "chest", share: 0.75 },
      { muscle: "triceps", share: 0.25 },
    ]);
  });

  it("summarises editor rows with half credit for secondary muscles", () => {
    const byId = new Map([
      [1, exercise(1, { primary_muscle: "chest", secondary_muscles: ["triceps"] })],
      [2, exercise(2, { measure: "min", primary_muscle: "cardio" })],
    ]);
    const summary = editorSummary(
      [
        { exercise_id: 1, measure: "reps", sets: 4, rep_max: 12, rest_seconds: 90 },
        { exercise_id: 2, measure: "min", sets: 1, rep_max: 20, rest_seconds: 0 },
      ],
      byId,
    );
    expect(summary).toEqual({ sets: 4, minutes: 29, muscles: [["chest", 4], ["triceps", 2]] });
  });

  it("describes adjusted cycle items", () => {
    const base = { exercise_id: 1, name: "x", sets: 3, target: "", target_weight: null, rest_seconds: 60, cue: "", change: null, replaces: null };
    expect(planItemAmount({ ...base, measure: "reps", rep_min: 8, rep_max: 12 })).toBe("3 × 8 to 12");
    expect(planItemAmount({ ...base, measure: "sec", rep_min: 30, rep_max: 30 })).toBe("3 × 30 s");
    expect(planItemAmount({ ...base, measure: "min", rep_min: 20, rep_max: null })).toBe("20 min");
    expect(planItemAmount({ ...base, measure: "reps", rep_min: null, rep_max: null, target: "" })).toBe("3 × free");
  });

  it("marks block weeks", () => {
    const block = { week: 2, weeks: 4, deload: false, early_deload: false } as BlockState;
    expect(blockWeeks(block).map((week) => week.classes)).toEqual(["done", "now", "", "deload"]);
    expect(blockWeeks({ ...block, week: 3, deload: true, early_deload: true }).map((week) => week.deload)).toEqual([false, false, true, true]);
  });
});

describe("equipment", () => {
  it("groups by category in a fixed order and drops empty groups", () => {
    const item = (key: string, category: string) => ({ key, category }) as Equipment;
    expect(groupEquipment([item("b", "machine"), item("a", "free_weight"), item("c", "machine")]).map(([key, , list]) => [key, list.map((entry) => entry.key)])).toEqual([
      ["free_weight", ["a"]],
      ["machine", ["b", "c"]],
    ]);
  });
});

describe("settings", () => {
  const field = (key: string, kind: SettingsField["kind"], value: string | boolean): SettingsField => ({ key, kind, value, group: "ai", label: key, options: null, source: "default" });
  it("only sends changed values and keeps secrets unless typed", () => {
    const fields = [field("model", "text", "a"), field("key", "secret", ""), field("on", "bool", false), field("port", "int", "80")];
    expect(changedValues(fields, { model: " a ", key: "", on: true, port: "81" })).toEqual({ on: true, port: "81" });
    expect(changedValues(fields, { key: "secret" })).toEqual({ key: "secret" });
  });
});

import { describe, expect, it } from "vitest";
import type { LeaderboardRow, LogEntry } from "../types";
import { canUndo, coachSays, logIcon, logTone, nextGapText, parseReport, weekRowState } from "../coaching";

const label = (muscle: string) => muscle.charAt(0).toUpperCase() + muscle.slice(1);

function row(id: number, rank: number, score: number, planned = 3): LeaderboardRow {
  return { id, rank, score, planned, name: "User " + String(id), color: "#fff", sex: "male", workouts: 1, adherence: 0, improvement: 0, records: 0, sets: 0, points: { consistency: 0, improvement: 0, records: 0, volume: 0 } };
}

describe("coach log", () => {
  it("maps kinds to tones and icons", () => {
    expect(logTone("weight_up")).toBe("k-up");
    expect(logTone("weight_down")).toBe("k-down");
    expect(logTone("swap")).toBe("k-swap");
    expect(logTone("deload_start")).toBe("k-block");
    expect(logTone("ai_note")).toBe("k-ai");
    expect(logTone("other")).toBe("k-neutral");
    expect(logIcon("swap")).toBe("⇄");
    expect(logIcon("mystery")).toBe("i");
  });

  it("only offers undo for versioned entries", () => {
    const base = { version_id: 4, undone: 0, kind: "swap" } as LogEntry;
    expect(canUndo(base)).toBe(true);
    expect(canUndo({ ...base, undone: 1 })).toBe(false);
    expect(canUndo({ ...base, kind: "undo" })).toBe(false);
    expect(canUndo({ ...base, version_id: null })).toBe(false);
  });
});

describe("weekly progress", () => {
  it("celebrates a complete week", () => {
    expect(coachSays({ start: "", days_left: 2, rows: [{ muscle: "chest", done: 10, planned: 10, priority: false }] }, label)).toMatch(/complete week/);
  });

  it("warns about priority muscles late in the week", () => {
    expect(coachSays({ start: "", days_left: 2, rows: [{ muscle: "glutes", done: 1, planned: 10, priority: true }] }, label)).toBe("Your priority glutes still need work this week.");
  });

  it("lists finished muscles", () => {
    const text = coachSays({ start: "", days_left: 5, rows: [{ muscle: "chest", done: 10, planned: 10, priority: false }, { muscle: "lats", done: 0, planned: 10, priority: false }] }, label);
    expect(text).toBe("Done for the week: chest.");
    expect(coachSays(null, label)).toBe("");
  });

  it("classifies bar states", () => {
    expect(weekRowState({ muscle: "a", done: 2, planned: 8, priority: false })).toEqual({ state: "open", share: 0.25, left: 6 });
    expect(weekRowState({ muscle: "a", done: 5, planned: 8, priority: false }).state).toBe("half");
    expect(weekRowState({ muscle: "a", done: 9, planned: 8, priority: false })).toEqual({ state: "done", share: 1, left: 0 });
  });
});

describe("leaderboard gaps", () => {
  it("explains the lead", () => {
    expect(nextGapText([row(1, 1, 50), row(2, 2, 40)], 1)).toBe("You lead. 10 points ahead of User 2.");
    expect(nextGapText([row(1, 1, 50)], 1)).toBe("You are the only one on the board this period.");
  });

  it("explains how to pass the next person", () => {
    expect(nextGapText([row(2, 1, 50), row(1, 2, 49, 4)], 1)).toBe("2 points to pass User 2. One more workout is worth up to 10.");
    expect(nextGapText([row(2, 1, 50)], 9)).toBe("");
  });
});

describe("report parsing", () => {
  it("splits markdown into blocks", () => {
    expect(parseReport("# Title\n## Sub\n### Small\n* item\n    * nested\n\ntext")).toEqual([
      { kind: "h2", text: "Title" },
      { kind: "h3", text: "Sub" },
      { kind: "h4", text: "Small" },
      { kind: "item", text: "item" },
      { kind: "sub", text: "nested" },
      { kind: "p", text: "text" },
    ]);
  });
});

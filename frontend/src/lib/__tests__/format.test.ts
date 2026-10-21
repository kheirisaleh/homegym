import { describe, expect, it } from "vitest";
import { addDays, formatClock, formatDay, formatSet, formatShortDay, fromIso, initials, minutesBetween, mondayOf, num, plural, relativeDay, toIso, weekdayIndex } from "../format";

describe("dates", () => {
  it("round trips iso dates in local time", () => {
    expect(toIso(fromIso("2026-02-28"))).toBe("2026-02-28");
    expect(toIso(addDays(fromIso("2026-02-28"), 1))).toBe("2026-03-01");
  });

  it("starts weeks on monday", () => {
    expect(weekdayIndex(fromIso("2026-10-19"))).toBe(0);
    expect(weekdayIndex(fromIso("2026-10-25"))).toBe(6);
    expect(toIso(mondayOf(fromIso("2026-10-25")))).toBe("2026-10-19");
  });

  it("formats days", () => {
    expect(formatDay("2026-10-21")).toBe("Wednesday, 21 October 2026");
    expect(formatDay("2026-10-21", false)).toBe("21 October 2026");
    expect(formatShortDay("2026-01-05")).toBe("5 Jan");
  });

  it("describes relative days", () => {
    expect(relativeDay("2026-10-21", "2026-10-21")).toBe("today");
    expect(relativeDay("2026-10-20", "2026-10-21")).toBe("yesterday");
    expect(relativeDay("2026-10-22", "2026-10-21")).toBe("tomorrow");
    expect(relativeDay("2026-10-16", "2026-10-21")).toBe("5 days ago");
    expect(relativeDay("2026-09-01", "2026-10-21")).toBe("1 Sep");
  });

  it("measures minutes between timestamps", () => {
    expect(minutesBetween("2026-10-21T10:00:00", "2026-10-21T10:45:20")).toBe(45);
    expect(minutesBetween("2026-10-21T10:00:00", null)).toBeNull();
  });
});

describe("numbers", () => {
  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(95.7)).toBe("1:35");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-4)).toBe("0:00");
  });

  it("rounds numbers without trailing zeros", () => {
    expect(num(2.25)).toBe("2.3");
    expect(num(40)).toBe("40");
    expect(num(1234.5, 0)).toBe("1,235");
    expect(num(null)).toBe("");
    expect(num(Number.NaN)).toBe("");
  });

  it("pluralises", () => {
    expect(plural(1, "set")).toBe("1 set");
    expect(plural(3, "set")).toBe("3 sets");
    expect(plural(2, "category", "categories")).toBe("2 categories");
  });
});

describe("sets", () => {
  it("formats weighted and bodyweight sets", () => {
    expect(formatSet({ value: 8, weight: 40 }, "reps", true)).toBe("40 kg × 8");
    expect(formatSet({ value: null, weight: 40 }, "reps", true)).toBe("40 kg × ?");
    expect(formatSet({ value: 12, weight: null }, "reps", false)).toBe("12 reps");
    expect(formatSet({ value: 45, weight: null }, "sec", false)).toBe("45 s");
    expect(formatSet({ value: null, weight: null }, "none", false)).toBe("done");
  });

  it("builds initials", () => {
    expect(initials("saleh kheiri")).toBe("SK");
    expect(initials("Max")).toBe("M");
  });
});

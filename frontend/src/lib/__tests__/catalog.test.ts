import { describe, expect, it } from "vitest";
import { extractVideoId, isVideo, mediaUrl, muscleColorVar, parseWeights, plateVar, shortMuscleName } from "../catalog";

describe("catalog helpers", () => {
  it("parses weight lists and ranges", () => {
    expect(parseWeights("2.5 5, 5;10")).toEqual([2.5, 5, 10]);
    expect(parseWeights("2.5..10/2.5")).toEqual([2.5, 5, 7.5, 10]);
    expect(parseWeights("20..22")).toEqual([20]);
    expect(parseWeights("1..5/0 abc -3")).toEqual([]);
  });

  it("extracts youtube ids from links", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("not a video")).toBeNull();
  });

  it("builds media urls", () => {
    expect(mediaUrl("a b.gif")).toBe("/media/a%20b.gif");
    expect(mediaUrl(null)).toBe("");
    expect(isVideo("x.MP4")).toBe(true);
    expect(isVideo("x.gif")).toBe(false);
  });

  it("names muscles and colours", () => {
    expect(shortMuscleName("biceps")).toBe("Biceps");
    expect(shortMuscleName("unknown")).toBe("unknown");
    expect(muscleColorVar("chest")).toBe("var(--plate-red)");
    expect(muscleColorVar(null)).toBe("var(--chalk-3)");
    expect(plateVar(-1)).toBe(plateVar(7));
  });
});

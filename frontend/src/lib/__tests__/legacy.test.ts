import { describe, expect, it } from "vitest";
import { isMobilePath, legacyHashTarget } from "@/app/legacy";

describe("legacy hash links", () => {
  it("maps desktop hashes to paths", () => {
    expect(legacyHashTarget("/", "#/programs/3")).toBe("/programs/3");
    expect(legacyHashTarget("/", "#/")).toBe("/");
    expect(legacyHashTarget("/", "")).toBeNull();
    expect(legacyHashTarget("/", "#section")).toBeNull();
  });

  it("maps mobile hashes below /m", () => {
    expect(legacyHashTarget("/m/", "#/train")).toBe("/m/train");
    expect(legacyHashTarget("/m", "#/")).toBe("/m");
  });

  it("detects mobile paths", () => {
    expect(isMobilePath("/m")).toBe(true);
    expect(isMobilePath("/m/plan")).toBe(true);
    expect(isMobilePath("/more")).toBe(false);
  });
});

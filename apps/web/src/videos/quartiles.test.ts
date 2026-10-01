// Viewership milestones fire once each, in order, from playback progress. No em dashes.
import { describe, it, expect } from "vitest";
import { createQuartileTracker, type Milestone } from "./quartiles.js";
import { aspectOf, formatDuration } from "./api.js";

describe("quartile tracker", () => {
  it("fires view_3s and each quartile once", () => {
    const seen: Milestone[] = [];
    const t = createQuartileTracker((m) => seen.push(m));
    for (const s of [1, 2, 3, 10, 25, 26, 50, 75, 99, 100]) t.update(s, 100);
    t.ended();
    expect(seen).toEqual(["view_3s", "completion_25", "completion_50", "completion_75", "completion_100"]);
  });
  it("does not report quartiles before the duration is known", () => {
    const seen: Milestone[] = [];
    const t = createQuartileTracker((m) => seen.push(m));
    t.update(5, Number.NaN);
    expect(seen).toEqual(["view_3s"]);
  });
});

describe("video formatting", () => {
  it("aspect follows the real size, else the orientation", () => {
    expect(aspectOf({ width: 1080, height: 1920, orientation: "vertical" })).toBe("1080 / 1920");
    expect(aspectOf({ width: null, height: null, orientation: "horizontal" })).toBe("16 / 9");
    expect(aspectOf({ width: null, height: null, orientation: null })).toBe("9 / 16");
  });
  it("durations read like a player clock", () => {
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("");
  });
});

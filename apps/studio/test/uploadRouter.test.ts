import { describe, it, expect } from "vitest";
import { chooseBackend, DEFAULT_R2_THRESHOLD_BYTES, r2ThresholdBytes } from "../src/api/uploadRouter.js";

const GB = 1024 * 1024 * 1024;

describe("upload backend routing", () => {
  it("routes small and mid-size masters to Supabase", () => {
    expect(chooseBackend(5 * 1024 * 1024)).toBe("supabase"); // 5MB
    expect(chooseBackend(2 * GB)).toBe("supabase"); // 2GB
    expect(chooseBackend(49 * GB)).toBe("supabase"); // just under
  });

  it("routes masters above the threshold to R2", () => {
    expect(chooseBackend(51 * GB)).toBe("r2");
    expect(chooseBackend(100 * GB)).toBe("r2");
  });

  it("treats exactly the threshold as Supabase (boundary is strictly greater)", () => {
    expect(chooseBackend(DEFAULT_R2_THRESHOLD_BYTES)).toBe("supabase");
    expect(chooseBackend(DEFAULT_R2_THRESHOLD_BYTES + 1)).toBe("r2");
  });

  it("honors a custom threshold and falls back to the 50GB default", () => {
    expect(chooseBackend(2 * GB, 1 * GB)).toBe("r2");
    expect(r2ThresholdBytes({ VITE_R2_THRESHOLD_BYTES: String(10 * GB) })).toBe(10 * GB);
    expect(r2ThresholdBytes({})).toBe(DEFAULT_R2_THRESHOLD_BYTES);
    expect(r2ThresholdBytes({ VITE_R2_THRESHOLD_BYTES: "not-a-number" })).toBe(DEFAULT_R2_THRESHOLD_BYTES);
  });
});

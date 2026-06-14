import { describe, it, expect } from "vitest";
import { assignControl, chooseBranch, DIRECTORS_CUT, type Candidate } from "./policy.js";
import { handleDecide, POLICY_VERSION, type DecisionDB } from "./decide.js";

const candidates: Candidate[] = [
  { variantId: "cccccccc-0000-0000-0000-00000000000a", branch: "calm" },
  { variantId: "cccccccc-0000-0000-0000-00000000000b", branch: "tense" },
];

describe("assignControl", () => {
  it("is stable per user", () => {
    expect(assignControl("user-123")).toBe(assignControl("user-123"));
  });
  it("keeps roughly the configured share in control", () => {
    let control = 0;
    for (let i = 0; i < 2000; i++) if (assignControl("u" + i, 10)) control++;
    expect(control).toBeGreaterThan(120); // ~10% of 2000 with generous slack
    expect(control).toBeLessThan(290);
  });
});

describe("chooseBranch", () => {
  it("control always gets the director's cut", () => {
    expect(chooseBranch(candidates, { intensity: 5 }, true).branch).toBe(DIRECTORS_CUT);
  });
  it("treatment, high intensity, gets tense", () => {
    expect(chooseBranch(candidates, { intensity: 5 }, false).branch).toBe("tense");
  });
  it("treatment, low intensity, gets calm", () => {
    expect(chooseBranch(candidates, { intensity: 2 }, false).branch).toBe("calm");
  });
  it("unknown viewer state falls back to calm", () => {
    expect(chooseBranch(candidates, {}, false).branch).toBe("calm");
  });
});

// Fake DB: forces an arm so the handler path is deterministic in tests.
function fakeDB(opts: { forceControl: boolean; intensity: number }): DecisionDB {
  let logged: any = null;
  const db: DecisionDB & { logged: () => any } = {
    seriesOfBeat: async () => "11111111-1111-1111-1111-111111111111",
    successorsOf: async () => candidates,
    viewerState: async () => ({ intensity: opts.intensity }),
    logDecision: async (row) => { logged = row; return "dddddddd-0000-0000-0000-000000000001"; },
    logged: () => logged,
  };
  return db;
}

describe("handleDecide", () => {
  it("returns decision_id, a chosen variant, prefetch hints, and policy version", async () => {
    const db = fakeDB({ forceControl: false, intensity: 5 });
    const res = await handleDecide(
      { user_id: "treatment-fixed", current_beat_id: "bbbbbbbb-0000-0000-0000-000000000002" },
      db
    );
    expect(res.decision_id).toBeTruthy();
    expect(res.next_variant_id).toBeTruthy();
    expect(res.prefetch_variant_ids.length).toBe(2);
    expect(res.policy_version).toBe(POLICY_VERSION);
    expect(typeof res.is_control).toBe("boolean");
  });
  it("throws at the end of the graph (no successors)", async () => {
    const db: DecisionDB = {
      seriesOfBeat: async () => "s",
      successorsOf: async () => [],
      viewerState: async () => ({}),
      logDecision: async () => "x",
    };
    await expect(
      handleDecide({ user_id: "u", current_beat_id: "end" }, db)
    ).rejects.toThrow("no_successors");
  });
});

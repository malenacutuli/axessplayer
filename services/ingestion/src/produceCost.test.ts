// SLICE B acceptance for the fan-out plan + cost preview (the JOB API CONTRACT cost-before-commit). Pure:
// the plan fans out per language / per sign language, the base language is never dubbed, only requested
// tracks appear, and estimatedUsd is the sum of the per-stage costs. No real money or media. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePlan, parseTargets, PRODUCE_COST_USD, type ProduceTargets } from "./produceCost.js";

const baseTargets = (over: Partial<ProduceTargets> = {}): ProduceTargets => ({
  languages: ["en", "es"],
  tracks: { cc: true, ad: true, sign: true, dub: true },
  signLanguages: ["ASL"],
  costTier: "hero",
  ...over,
});

describe("computePlan fan-out + estimate", () => {
  it("fans captions/cwi/ad per language, dubbing per NON-base language, sign per sign language", () => {
    const plan = computePlan(baseTargets(), 1);
    const byName = new Map(plan.stages.map((s) => [s.name, s]));
    assert.equal(byName.get("transcript")?.count, 1);
    assert.equal(byName.get("captions")?.count, 2); // en + es
    assert.equal(byName.get("cwi")?.count, 2);
    assert.equal(byName.get("ad")?.count, 2);
    assert.equal(byName.get("dubbing")?.count, 1); // es only, en is base (original audio)
    assert.equal(byName.get("sign")?.count, 1); // ASL
    assert.equal(byName.get("poster")?.count, 1);
  });

  it("estimatedUsd equals the sum of the per-stage costs and is non-zero", () => {
    const plan = computePlan(baseTargets(), 1);
    const sum = plan.stages.reduce((s, p) => s + p.costUsd, 0);
    assert.equal(plan.estimatedUsd, Math.round(sum * 100) / 100);
    assert.ok(plan.estimatedUsd > 0);
    // hand-checked: transcript .03 + captions 2*.04 + cwi 2*.04 + ad 2*.35 + dub .45 + sign .2 + poster .04
    assert.equal(plan.estimatedUsd, Math.round((0.03 + 0.08 + 0.08 + 0.7 + 0.45 + 0.2 + 0.04) * 100) / 100);
  });

  it("scales the per-beat fan-out by the beat count", () => {
    const one = computePlan(baseTargets(), 1);
    const five = computePlan(baseTargets(), 5);
    assert.ok(five.estimatedUsd > one.estimatedUsd);
    const cap1 = one.stages.find((s) => s.name === "captions")!;
    const cap5 = five.stages.find((s) => s.name === "captions")!;
    assert.equal(cap5.count, cap1.count * 5);
  });

  it("only requested tracks appear in the plan", () => {
    const plan = computePlan(baseTargets({ tracks: { cc: true } }), 1);
    const names = plan.stages.map((s) => s.name);
    assert.ok(names.includes("captions"));
    assert.ok(!names.includes("ad"));
    assert.ok(!names.includes("dubbing"));
    assert.ok(!names.includes("sign"));
    // transcript / poster / register / publish are always present.
    assert.ok(names.includes("transcript") && names.includes("poster"));
    assert.ok(names.includes("register") && names.includes("publish"));
  });

  it("a single-language request with dub requested produces no dubbing stage (no non-base language)", () => {
    const plan = computePlan(baseTargets({ languages: ["en"], signLanguages: [] }), 1);
    assert.ok(!plan.stages.some((s) => s.name === "dubbing"));
    assert.ok(!plan.stages.some((s) => s.name === "sign"));
  });

  it("register and publish are bookkeeping (zero cost, not cost-bearing)", () => {
    const plan = computePlan(baseTargets(), 1);
    for (const name of ["register", "publish"] as const) {
      const st = plan.stages.find((s) => s.name === name)!;
      assert.equal(st.costUsd, 0);
      assert.equal(st.costBearing, false);
    }
  });

  it("the copied cost constants match the live content service values (flagged)", () => {
    assert.equal(PRODUCE_COST_USD.transcript, 0.03);
    assert.equal(PRODUCE_COST_USD.ad, 0.35);
    assert.equal(PRODUCE_COST_USD.dub, 0.45);
    assert.equal(PRODUCE_COST_USD.sign, 0.2);
  });
});

describe("parseTargets validation", () => {
  it("accepts a {targets:{...}} envelope and a bare targets object", () => {
    const a = parseTargets({ targets: { languages: ["en"], tracks: { cc: true } } });
    const b = parseTargets({ languages: ["en"], tracks: { cc: true } });
    assert.ok("targets" in a && a.targets.languages[0] === "en");
    assert.ok("targets" in b && b.targets.tracks.cc === true);
  });

  it("rejects a body with no languages", () => {
    const r = parseTargets({ languages: [] });
    assert.ok("error" in r && r.error === "no_languages");
  });

  it("rejects a non-object body", () => {
    assert.ok("error" in parseTargets(null));
    assert.ok("error" in parseTargets("x"));
  });
});

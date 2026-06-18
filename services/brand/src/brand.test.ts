// Spec-derived tests for the brand revenue rail (prompt 19 + P10 hard gates). Focus on the invariants a
// reviewer must see hold:
//   1. CONTENT/AD PLANE FIREWALL: the BrandDB exposes NO method that names a content-ranking/decision
//      table, and the brand-match flywheel objective takes NO content reward signal. Structural, asserted.
//   2. brand-safety + canon-safety HARD filters BLOCK a disallowed brand/context pairing (fails closed).
//   3. a fill produces c2pa + article50 + a full immutable audit record.
//   4. the demand rail is an ADAPTER interface with NO computer-vision capability (license-not-build).
//   5. billing RECONCILES to double-entry ledger entries (debits == credits, sums match spend).
// Pure logic + in-memory store; nothing transacts a live rail. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkFillAllowed, checkBrandSafety, checkCanonSafety } from "./safety.js";
import { placeFill } from "./placement.js";
import { brandMatchScore, creativeIpsScore, rerankCandidates } from "./flywheel.js";
import { billableCents, buildLedgerEntry, reconcileCampaign } from "./billing.js";
import { createInMemoryBrandDB } from "./store.js";
import { createStubDemandAdapter, createStubSsaiAdapter, assertNoVisionCapability, type DemandAdapter } from "./demand.js";
import { testVerifiers } from "./auth.js";
import type { BrandCampaign, FillCandidate, PlacementSlot } from "./types.js";

const NOW = () => "2026-06-18T00:00:00.000Z";

function campaign(overrides: Partial<BrandCampaign> = {}): BrandCampaign {
  return {
    id: "camp-1",
    brandId: "brand-1",
    product: "Cola",
    category: "beverage",
    targeting: {},
    dealModel: "CPM",
    rateCents: 5000,
    budgetCents: 100000,
    spentCents: 0,
    status: "active",
    approvalState: "approved",
    freqCapPerViewer: 3,
    createdAt: NOW(),
    ...overrides,
  };
}

function slot(overrides: Partial<PlacementSlot> = {}): PlacementSlot {
  return {
    id: "slot-1",
    seriesId: "series-1",
    beatId: "beat-1",
    allowedCategories: ["beverage"],
    canonConstraints: {},
    groundTruthMetadata: { surface: "can-on-table", lighting: "warm-interior" },
    contentRating: "PG",
    createdAt: NOW(),
    ...overrides,
  };
}

function candidate(overrides: Partial<FillCandidate> = {}): FillCandidate {
  return {
    campaignId: "camp-1",
    brandId: "brand-1",
    category: "beverage",
    region: "NA",
    creativeRef: "creative-cola-na",
    supportedSurfaces: ["can-on-table"],
    ...overrides,
  };
}

describe("1. content/ad plane firewall (structural)", () => {
  it("the BrandDB interface names NO content-ranking / decision table", async () => {
    const db = createInMemoryBrandDB(NOW);
    const methods = Object.keys(db);
    const FORBIDDEN = ["beat_variant", "decision", "engagement", "reward", "cut", "ranking", "recommend"];
    for (const m of methods) {
      const lower = m.toLowerCase();
      for (const f of FORBIDDEN) {
        assert.ok(!lower.includes(f), `BrandDB method ${m} must not reference content-plane concept ${f}`);
      }
    }
    // The brand store only knows brand-plane nouns.
    assert.deepEqual(
      methods.sort(),
      [
        "bill", "createBrand", "createCampaign", "createSlot", "fillCountForViewer",
        "getCampaign", "getSlot", "ledgerFor", "listBrands", "listCampaigns",
        "listPerformance", "listSlots", "recordFill", "recordPerformance",
      ].sort(),
    );
  });

  it("the brand-match objective takes ONLY brand signals, never a content reward", () => {
    // brandMatchScore's input type is screen_time/completion/attention. A content reward signal cannot be
    // passed without a type error; at runtime it is ignored. Identical brand signals -> identical score
    // regardless of any extra (content) field smuggled in.
    const base = { screenTime: 15, completion: 0.8, attention: 0.7 };
    const withContentSignal = { ...base, contentReward: 999, retention: 1 } as unknown as typeof base;
    assert.equal(brandMatchScore(base), brandMatchScore(withContentSignal));
  });

  it("re-rank reorders brand candidates only and is monotonic in brand-match score", () => {
    const cands = [candidate({ creativeRef: "a" }), candidate({ creativeRef: "b" })];
    const history = new Map([
      ["a", [{ id: "p1", fillId: "f1", screenTime: 0, completion: 0, attention: 0, propensity: 1, createdAt: NOW() }]],
      ["b", [{ id: "p2", fillId: "f2", screenTime: 30, completion: 1, attention: 1, propensity: 1, createdAt: NOW() }]],
    ]);
    const ranked = rerankCandidates(cands, history);
    assert.equal(ranked[0].creativeRef, "b"); // higher brand-match floats up
  });
});

describe("2. brand-safety + canon-safety HARD filters block a disallowed pairing", () => {
  it("brand-safety blocks an out-of-allow-list category", () => {
    const r = checkBrandSafety(candidate({ category: "alcohol" }), slot({ allowedCategories: ["beverage"] }));
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("not in the slot allow list")));
  });

  it("brand-safety blocks alcohol in a PG slot (rating gate)", () => {
    const r = checkBrandSafety(candidate({ category: "alcohol" }), slot({ allowedCategories: ["alcohol"], contentRating: "PG" }));
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("requires rating")));
  });

  it("canon-safety blocks a forbidden brand and a wrong-era creative", () => {
    const forbiddenBrand = checkCanonSafety(candidate(), { forbiddenBrands: ["brand-1"] });
    assert.equal(forbiddenBrand.ok, false);
    const wrongEra = checkCanonSafety(candidate({ creativeEra: "modern" }), { era: "1920s" });
    assert.equal(wrongEra.ok, false);
  });

  it("placeFill returns blocked + reason when nothing is safe (fails closed)", async () => {
    const res = await placeFill(
      slot({ allowedCategories: ["beverage"], canonConstraints: { forbiddenBrands: ["brand-1"] } }),
      [candidate()],
      {},
      { campaignFor: () => campaign(), demand: createStubDemandAdapter(), now: NOW },
    );
    assert.equal(res.filled, false);
    if (!res.filled) assert.ok(res.reason.includes("canon forbids brand"));
  });
});

describe("3. a fill produces c2pa + article50 + a full audit record", () => {
  it("personalized fill is C2PA-signed, Article-50 disclosed, and carries a ground-truth audit", async () => {
    const res = await placeFill(
      slot(),
      [candidate({ personalized: true })],
      { country: "US", viewerHash: "vh-1" },
      { campaignFor: () => campaign(), demand: createStubDemandAdapter(), now: NOW },
    );
    assert.equal(res.filled, true);
    if (!res.filled) return;
    assert.equal(res.fill.c2paSigned, true);
    assert.equal(res.fill.article50, true); // personalized -> disclosed
    assert.equal(res.fill.audit.campaignId, "camp-1");
    assert.equal(res.fill.audit.provenance.groundTruth, true);
    assert.equal(res.fill.audit.provenance.cv, false); // provenance asserts NO computer vision
    assert.ok(res.fill.audit.licensing.demandRail.length > 0);
  });

  it("non-personalized fill still signs C2PA but article50 is false (no personalization to disclose)", async () => {
    const res = await placeFill(
      slot(),
      [candidate({ personalized: false })],
      { country: "US" },
      { campaignFor: () => campaign(), demand: createStubDemandAdapter(), now: NOW },
    );
    assert.equal(res.filled, true);
    if (!res.filled) return;
    assert.equal(res.fill.c2paSigned, true);
    assert.equal(res.fill.article50, false);
  });

  it("an unapproved campaign cannot fill", async () => {
    const res = await placeFill(
      slot(),
      [candidate()],
      {},
      { campaignFor: () => campaign({ approvalState: "pending" }), demand: createStubDemandAdapter(), now: NOW },
    );
    assert.equal(res.filled, false);
  });
});

describe("4. the demand rail is an ADAPTER interface with no CV (license-not-build)", () => {
  it("the stub demand + SSAI adapters expose select/report/selectVariant and NO vision capability", () => {
    const demand = createStubDemandAdapter();
    const ssai = createStubSsaiAdapter();
    assert.equal(typeof demand.select, "function");
    assert.equal(typeof demand.report, "function");
    assert.equal(typeof ssai.selectVariant, "function");
    // No CV/zone-detection/tracking method may exist on the adapter.
    assert.doesNotThrow(() => assertNoVisionCapability(demand));
  });

  it("assertNoVisionCapability THROWS if an adapter smuggles a CV method", () => {
    const bad = {
      ...createStubDemandAdapter(),
      detectZones: () => [],
    } as unknown as DemandAdapter;
    assert.throws(() => assertNoVisionCapability(bad), /license-not-build/);
  });

  it("the adapter selects among ground-truth-bound candidates only (no pixel input in its signature)", async () => {
    const demand = createStubDemandAdapter();
    const out = await demand.select([candidate()], { country: "US" });
    assert.ok(out);
    assert.equal(out?.candidate.creativeRef, "creative-cola-na");
    assert.ok((out?.propensity ?? 0) > 0); // strictly positive logged propensity for off-policy lift
  });
});

describe("5. billing reconciles to double-entry ledger entries", () => {
  it("each billable fill posts a BALANCED debit/credit pair (sums match)", () => {
    const c = campaign({ dealModel: "CPM", rateCents: 5000 });
    const amount = billableCents(c, { actions: 1 });
    assert.equal(amount, 5); // 5000 cpm / 1000
    const lines = buildLedgerEntry(c, { id: "fill-1" }, amount, "txn-1");
    assert.equal(lines.length, 2);
    const debit = lines.find((l) => l.direction === "debit")!;
    const credit = lines.find((l) => l.direction === "credit")!;
    assert.equal(debit.account, "campaign_budget");
    assert.equal(credit.account, "platform_revenue");
    assert.equal(debit.amountCents, credit.amountCents);
    const recon = reconcileCampaign(c.id, lines);
    assert.equal(recon.balanced, true);
    assert.equal(recon.debitCents, recon.creditCents);
    assert.equal(recon.spentCents, amount);
  });

  it("store.bill is idempotent: a replayed client_txn_id does not double-bill, and ledger stays balanced", async () => {
    const db = createInMemoryBrandDB(NOW);
    const c = await db.createCampaign({
      brandId: "b", product: "Cola", category: "beverage", targeting: {},
      dealModel: "flat", rateCents: 250, budgetCents: 10000, status: "active",
      approvalState: "approved", freqCapPerViewer: 3,
    });
    const fill = await db.recordFill({
      slotId: "s", campaignId: c.id, region: "NA", creativeRef: "cr",
      c2paSigned: true, article50: false,
      audit: {
        campaignId: c.id, brandId: "b", creativeRef: "cr", region: "NA", targetingSnapshot: {},
        dealModel: "flat", rateCents: 250,
        licensing: { demandRail: "magnite", license: "magnite-streaming-ssp" },
        provenance: { groundTruth: true, cv: false, signedAt: NOW() },
      },
    });
    const first = await db.bill(c.id, fill, "txn-A");
    const replay = await db.bill(c.id, fill, "txn-A"); // same txn -> no-op
    assert.equal(first.length, 2);
    assert.equal(replay.length, 0);
    const lines = await db.ledgerFor(c.id);
    const recon = reconcileCampaign(c.id, lines);
    assert.equal(recon.balanced, true);
    assert.equal(recon.lineCount, 2); // not doubled
    // Recognized spend reconciles to the campaign's spent_cents.
    const after = await db.getCampaign(c.id);
    assert.equal(after?.spentCents, recon.spentCents);
    assert.equal(after?.spentCents, 250);
  });

  it("creativeIpsScore is propensity-weighted (off-policy honest), not a raw mean", () => {
    const rows = [
      { id: "1", fillId: "f", screenTime: 30, completion: 1, attention: 1, propensity: 0.25, createdAt: NOW() },
      { id: "2", fillId: "f", screenTime: 0, completion: 0, attention: 0, propensity: 1, createdAt: NOW() },
    ];
    const ips = creativeIpsScore(rows);
    // The high-score row has low propensity (weight 4) so it dominates: IPS > the unweighted mean (0.5).
    assert.ok(ips > 0.5);
  });
});

describe("auth: advertiser/operator verifier stub", () => {
  it("operator secret authorizes; advertiser:<uuid> resolves; junk is rejected", async () => {
    const v = testVerifiers("op-secret");
    assert.equal(await v.operator.verifyOperator("op-secret"), true);
    assert.equal(await v.operator.verifyOperator("nope"), false);
    const adv = await v.advertiser.verifyAdvertiser("advertiser:11111111-1111-1111-1111-111111111111");
    assert.equal(adv?.advertiserId, "11111111-1111-1111-1111-111111111111");
    assert.equal(await v.advertiser.verifyAdvertiser("advertiser:not-a-uuid"), null);
  });
});

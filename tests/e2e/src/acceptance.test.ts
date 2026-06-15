// W12 end-to-end acceptance gate. The whole build points here: one viewer walks the seed graph and the
// adaptive loop fires for real, against the INTEGRATED system. Every service is a REAL listening HTTP
// server on an ephemeral localhost port, driven with a real fetch client over the network (NOT in-process
// handler calls), reading and writing one REAL Postgres (embedded-postgres locally, a postgres:15 service
// in CI) with migrations 0001..0005 + supabase/seed.sql applied to a fresh database.
//
// Asserts every hop of the brief:
//   1. Fresh real Postgres, migrations + seed applied.
//   2. Cold open: a viewer starts; viewer_state is present (seeded).
//   3. At the branch beat, POST /decide (over HTTP) returns decision_id, next_variant_id,
//      prefetch_variant_ids, is_control, policy_version, and a decision_log row is written (with
//      propensity for the treatment arm).
//   4. GET /manifest/{variant_id}.m3u8 (over HTTP) returns a parseable HLS playlist for the chosen and
//      prefetch variants.
//   5. The player-sdk selects and switches to the chosen cut at the branch point (switch decision,
//      prefetch buffered in time). Device-level frame-accurate playback is OUT OF SCOPE (W5 on hardware)
//      and is flagged, not faked: we assert the switch DECISION and that the chosen cut was buffered.
//   6. BOTH ARMS: a treatment viewer (intensity 5) receives the tense cut; a control viewer receives the
//      director's cut (calm).
//   7. Premium ending: POST /spend (session-scoped, own-once) unlocks the premium variant, deducts 5,
//      grants the entitlement; a replay and a second distinct-txn buy are BOTH no-ops; the entitlement
//      now gates the variant.
//
// Runner: node --test + tsx. No em dashes.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { startPg, type PgHandle } from "./pg.js";
import { startServices, SERVICE_SECRET, type Services } from "./servers.js";
import {
  SERIES,
  BEAT_COLD_OPEN,
  BEAT_BRANCH,
  VAR_COLD_OPEN,
  VAR_BRANCHPOINT,
  VAR_CALM,
  VAR_TENSE,
  VAR_ENDING_PREMIUM,
  USER_TREATMENT,
  USER_CONTROL,
  seedControlViewer,
} from "./fixtures.js";

import { BranchingPlayer, createHttpTransport } from "@axessplayer/player-sdk";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pgh: PgHandle;
let svc: Services;

before(async () => {
  // HOP 1: fresh real Postgres, migrations 0001..0005 + seed applied.
  pgh = await startPg();
  await seedControlViewer(pgh.pool); // the extra control-arm viewer (both seed users are treatment)
  svc = await startServices(pgh.pool);
});

after(async () => {
  if (svc) await svc.stopAll();
  if (pgh) await pgh.stop();
});

// --- helpers: real over-the-network calls against the bound servers ---

const sessionAuth = (userId: string) => ({ authorization: `Bearer session:${userId}` });

async function decideOverHttp(userId: string, beatId: string, signals: Record<string, unknown>) {
  const res = await fetch(`${svc.decision.baseUrl}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionAuth(userId) },
    body: JSON.stringify({ current_beat_id: beatId, signals }),
  });
  return res;
}

async function getManifest(variantId: string) {
  return fetch(`${svc.manifest.baseUrl}/manifest/${variantId}.m3u8`);
}

async function getWallet(userId: string) {
  const res = await fetch(`${svc.economy.baseUrl}/wallet`, { headers: { ...sessionAuth(userId) } });
  return res;
}

async function spendOverHttp(userId: string, scopeId: string, clientTxnId: string) {
  return fetch(`${svc.economy.baseUrl}/spend`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionAuth(userId) },
    body: JSON.stringify({ scope: "beat_variant", scope_id: scopeId, client_txn_id: clientTxnId }),
  });
}

// A playlist is "parseable HLS" when it starts with the EXTM3U tag and carries the version + an end tag
// (the manifest service emits a VOD media playlist for the single-rendition seed variants).
function assertParseableHls(text: string, variantId: string) {
  const lines = text.split("\n").map((l) => l.trim());
  assert.equal(lines[0], "#EXTM3U", `playlist for ${variantId} must start with #EXTM3U`);
  assert.ok(
    lines.some((l) => l.startsWith("#EXT-X-VERSION:")),
    `playlist for ${variantId} must declare a version`
  );
  assert.ok(
    lines.some((l) => l.startsWith("#EXTINF:")),
    `playlist for ${variantId} must list at least one segment`
  );
  assert.ok(
    lines.includes("#EXT-X-ENDLIST"),
    `VOD playlist for ${variantId} must end with #EXT-X-ENDLIST`
  );
}

// ---------------------------------------------------------------------------------------------------

test("HOP 1: a real Postgres has the migrations and seed applied", async () => {
  // The services bind to the network, and the seed graph is queryable.
  const series = await pgh.pool.query("select id, title from public.series where id = $1", [SERIES]);
  assert.equal(series.rows.length, 1);
  assert.equal(series.rows[0].title, "The Last Signal");
  // The 0005 column exists (propensity), proving the full migration chain ran.
  const col = await pgh.pool.query(
    `select 1 from information_schema.columns
      where table_name = 'decision_log' and column_name = 'propensity'`
  );
  assert.equal(col.rows.length, 1, "decision_log.propensity (migration 0005) must exist");
  // The four services are real listening HTTP servers on ephemeral ports.
  for (const s of [svc.economy, svc.decision, svc.content, svc.manifest]) {
    assert.match(s.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  }
});

test("HOP 2: cold open: the viewer's viewer_state is present, and content graph is served over HTTP", async () => {
  // viewer_state seeded for the treatment viewer.
  const vs = await pgh.pool.query(
    "select preference_vector, cohort_id from public.viewer_state where user_id = $1 and series_id = $2",
    [USER_TREATMENT, SERIES]
  );
  assert.equal(vs.rows.length, 1, "the cold-open viewer has viewer_state");

  // The content service serves the playable graph over the network (W1 hop), proving the cold open beat
  // and the branch point are in the graph the player will walk.
  const res = await fetch(`${svc.content.baseUrl}/series/${SERIES}/graph`);
  assert.equal(res.status, 200);
  const graph = (await res.json()) as {
    series: { id: string };
    episodes: { beats: { id: string; is_branch_point: boolean }[] }[];
  };
  assert.equal(graph.series.id, SERIES);
  const beats = graph.episodes.flatMap((e) => e.beats);
  assert.ok(beats.some((b) => b.id === BEAT_COLD_OPEN), "cold open beat present");
  const branch = beats.find((b) => b.id === BEAT_BRANCH);
  assert.ok(branch && branch.is_branch_point, "branch point beat present and flagged");

  // Cold open decision over HTTP advances to the branch point's variant (single successor).
  const coldRes = await decideOverHttp(USER_TREATMENT, BEAT_COLD_OPEN, { completion: 1 });
  assert.equal(coldRes.status, 200);
  const cold = (await coldRes.json()) as { next_variant_id: string };
  assert.equal(cold.next_variant_id, VAR_BRANCHPOINT, "cold open leads into the branch point");
  void VAR_COLD_OPEN;
});

test("HOP 3: POST /decide over HTTP returns the contract shape and writes a decision_log row with propensity (treatment)", async () => {
  const before = await pgh.pool.query("select count(*)::int as n from public.decision_log");

  const res = await decideOverHttp(USER_TREATMENT, BEAT_BRANCH, {
    completion: 1,
    dwell_ms: 60000,
    replays: 3,
    skipped: false,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    decision_id: string;
    next_variant_id: string;
    prefetch_variant_ids: string[];
    is_control: boolean;
    policy_version: string;
  };
  assert.match(body.decision_id, UUID_RE, "decision_id is a uuid");
  assert.ok(body.next_variant_id === VAR_CALM || body.next_variant_id === VAR_TENSE);
  assert.ok(Array.isArray(body.prefetch_variant_ids));
  assert.equal(typeof body.is_control, "boolean");
  assert.equal(typeof body.policy_version, "string");
  assert.ok(body.policy_version.startsWith("linucb-"), "policy_version is the LinUCB build");

  // A decision_log row was written for this decision, and the treatment arm carries a propensity.
  const after = await pgh.pool.query("select count(*)::int as n from public.decision_log");
  assert.equal(after.rows[0].n, before.rows[0].n + 1, "exactly one decision_log row written");

  const row = await pgh.pool.query(
    `select user_id, beat_id, served_variant_id, is_control, policy_version, propensity
       from public.decision_log where id = $1`,
    [body.decision_id]
  );
  assert.equal(row.rows.length, 1, "the decision_id is the decision_log primary key");
  assert.equal(row.rows[0].user_id, USER_TREATMENT);
  assert.equal(row.rows[0].beat_id, BEAT_BRANCH);
  assert.equal(row.rows[0].served_variant_id, body.next_variant_id);
  assert.equal(row.rows[0].is_control, false, "treatment arm logged as not control");
  assert.ok(
    row.rows[0].propensity !== null && Number(row.rows[0].propensity) > 0,
    `treatment decision logged a propensity: ${row.rows[0].propensity}`
  );
});

test("HOP 4: GET /manifest/{variant_id}.m3u8 over HTTP returns a parseable HLS playlist for chosen and prefetch variants", async () => {
  const res = await decideOverHttp(USER_TREATMENT, BEAT_BRANCH, { completion: 1, replays: 3 });
  const body = (await res.json()) as { next_variant_id: string; prefetch_variant_ids: string[] };

  const ids = [body.next_variant_id, ...body.prefetch_variant_ids];
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const m = await getManifest(id);
    assert.equal(m.status, 200, `manifest ${id} should be 200`);
    assert.equal(
      m.headers.get("content-type"),
      "application/vnd.apple.mpegurl",
      "HLS content type"
    );
    assertParseableHls(await m.text(), id);
  }

  // A non-existent variant 404s over the same real server.
  const missing = await getManifest("dddddddd-0000-0000-0000-000000000099");
  assert.equal(missing.status, 404);
});

test("HOP 5: the player-sdk selects and switches to the chosen cut at the branch point, prefetched in time", async () => {
  // Drive the REAL player-sdk over a real HTTP transport pointed at the bound decision + manifest servers.
  // The SDK transport takes an injectable fetch; the host app (web/native shell) is responsible for
  // attaching the viewer's session credential, so here we wrap fetch to add the session bearer the
  // decision adapter's trust boundary requires. This is host wiring, not a change to the SDK or service.
  const authedFetch: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer session:${USER_TREATMENT}`);
    return globalThis.fetch(input, { ...init, headers });
  };
  const transport = createHttpTransport({
    decisionBaseUrl: svc.decision.baseUrl,
    manifestBaseUrl: svc.manifest.baseUrl,
    fetch: authedFetch,
  });
  const player = new BranchingPlayer({
    transport,
    userId: USER_TREATMENT,
    startBeatId: BEAT_BRANCH,
  });
  // Signals the host measured on the branch-point beat fold into this /decide.
  player.recordSignals({ completion: 1, dwell_ms: 60000, replays: 3, skipped: false });

  const step = await player.advance();

  // The switch DECISION at the branch point: the chosen cut was buffered, so it is the seamless choice.
  assert.equal(step.beatId, BEAT_BRANCH);
  assert.equal(step.played.reason, "chosen", "the chosen cut was prefetched, so the switch is chosen");
  assert.equal(step.played.seamless, true, "chosen cut buffered in time => seamless switch decision");
  assert.equal(step.played.variantId, step.decision.next_variant_id);
  assert.ok(
    step.bufferedAtBranch.includes(step.decision.next_variant_id),
    "the chosen cut was buffered when the branch point arrived"
  );
  assert.deepEqual(step.missed, [], "no prefetch missed");
  // Treatment viewer with the seeded TENSE arm and high-intensity signals lands on the tense cut.
  assert.equal(step.played.variantId, VAR_TENSE, "treatment viewer switched to the tense cut");
});

test("HOP 6 both arms: treatment (intensity 5) gets the tense cut; control gets the director's cut (calm)", async () => {
  // Treatment arm, over HTTP. High-intensity signals + the seeded TENSE arm => tense cut.
  const t = await decideOverHttp(USER_TREATMENT, BEAT_BRANCH, {
    completion: 1,
    dwell_ms: 60000,
    replays: 3,
    skipped: false,
  });
  assert.equal(t.status, 200);
  const tBody = (await t.json()) as { next_variant_id: string; is_control: boolean };
  assert.equal(tBody.is_control, false, "treatment viewer is on the bandit arm");
  assert.equal(tBody.next_variant_id, VAR_TENSE, "treatment intensity-5 viewer receives the tense cut");

  // Control arm, over HTTP. Same beat, same signals: the control holdout always gets the director's cut.
  const c = await decideOverHttp(USER_CONTROL, BEAT_BRANCH, {
    completion: 1,
    dwell_ms: 60000,
    replays: 3,
    skipped: false,
  });
  assert.equal(c.status, 200);
  const cBody = (await c.json()) as { next_variant_id: string; is_control: boolean; decision_id: string };
  assert.equal(cBody.is_control, true, "control viewer is flagged is_control");
  assert.equal(cBody.next_variant_id, VAR_CALM, "control viewer receives the director's cut (calm)");

  // The control decision logged null propensity (deterministic policy), per the 0005 column semantics.
  const row = await pgh.pool.query("select propensity from public.decision_log where id = $1", [
    cBody.decision_id,
  ]);
  assert.equal(row.rows[0].propensity, null, "control/deterministic decision logs null propensity");
});

test("HOP 7 premium own-once: /spend unlocks the premium ending, deducts 5, and a replay + a distinct-txn buy are both no-ops", async () => {
  // Pre-state: the treatment viewer starts at 10 coins, no entitlement on the premium ending.
  const w0 = await getWallet(USER_TREATMENT);
  const wallet0 = (await w0.json()) as {
    balance: number;
    entitlements: { scope: string; scope_id: string }[];
  };
  assert.equal(wallet0.balance, 10, "viewer starts with 10 coins");
  assert.ok(
    !wallet0.entitlements.some((e) => e.scope_id === VAR_ENDING_PREMIUM),
    "premium ending is not yet owned"
  );

  // First buy: deducts 5 (cost from beat_variants.coin_cost), grants the entitlement.
  const buy1 = await spendOverHttp(USER_TREATMENT, VAR_ENDING_PREMIUM, "premium-buy-1");
  assert.equal(buy1.status, 200);
  const buy1Body = (await buy1.json()) as {
    balance: number;
    entitlement: { scope: string; scope_id: string };
  };
  assert.equal(buy1Body.balance, 5, "5 coins deducted (10 -> 5)");
  assert.equal(buy1Body.entitlement.scope, "beat_variant");
  assert.equal(buy1Body.entitlement.scope_id, VAR_ENDING_PREMIUM);

  // Replay (same client_txn_id): idempotent no-op, balance unchanged.
  const replay = await spendOverHttp(USER_TREATMENT, VAR_ENDING_PREMIUM, "premium-buy-1");
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as { balance: number }).balance, 5, "replay is a no-op (own-once idempotency)");

  // Second DISTINCT client_txn_id buy of the already-owned variant: own-once no-op, NOT a second charge.
  const buy2 = await spendOverHttp(USER_TREATMENT, VAR_ENDING_PREMIUM, "premium-buy-2-distinct");
  assert.equal(buy2.status, 200);
  assert.equal(
    ((await buy2.json()) as { balance: number }).balance,
    5,
    "a second distinct-txn buy of owned content is a no-op (F4 own-once), not a second 5-coin charge"
  );

  // The entitlement now gates the variant: the wallet shows it owned, charged exactly once.
  const wEnd = await getWallet(USER_TREATMENT);
  const walletEnd = (await wEnd.json()) as {
    balance: number;
    entitlements: { scope: string; scope_id: string }[];
  };
  assert.equal(walletEnd.balance, 5, "charged exactly once across replay + distinct-txn buy");
  assert.ok(
    walletEnd.entitlements.some(
      (e) => e.scope === "beat_variant" && e.scope_id === VAR_ENDING_PREMIUM
    ),
    "the entitlement now gates the premium variant"
  );

  // Ledger proof: exactly one spend transaction recorded for the premium variant (one deduction).
  const txns = await pgh.pool.query(
    `select count(*)::int as n from public.coin_transactions
      where user_id = $1 and type = 'spend' and reference_id = $2`,
    [USER_TREATMENT, VAR_ENDING_PREMIUM]
  );
  assert.equal(txns.rows[0].n, 1, "exactly one spend ledger row for the premium variant");
});

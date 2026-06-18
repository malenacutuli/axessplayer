// HTTP adapter for the admin API. A thin Hono app over the aggregation layer (aggregate.ts), wrapping
// every route in the operator-auth trust boundary and the RBAC layer, with the immutable-audit seam
// mounted for mutations. It does only edge work: authenticate, authorize, parse, delegate, map result.
// All aggregation/SQL lives below this layer. No em dashes.
//
// Request lifecycle on every /admin route:
//   1. AUTHN: resolve the acting operator from the Bearer operator-token. null -> 401 unauthorized.
//   2. RBAC: decide(role, path, method). deny -> 403 forbidden (with a stable reason).
//   3. AUDIT (mutations only): a successful mutation appends to the AdminAuditSink. This wave ships only
//      GET routes so nothing appends yet, but the helper is built so the first mutating route is covered.
//   4. Delegate to the aggregation layer and return the contract DTO.
//
// HARD GATE: reward-function weights are returned DISPLAY-ONLY (the dashboard carries a policy version and
// rewardWeightsEditable:false), and there is no route that writes them. A weight change is a founder
// sign-off, never an operator/agent action.

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import { parseBearer, type OperatorVerifier, type OperatorIdentity } from "../auth.js";
import { decide } from "../rbac.js";
import type { AdminAuditSink, AuditEntry } from "../audit.js";
import {
  buildDashboard,
  buildContentTree,
  buildContentDetail,
  buildStoryGraph,
  buildMediaFactoryJobs,
  buildAccessibility,
  buildBrands,
  buildCampaigns,
  buildPlacements,
  buildUsersPage,
  buildUserDetail,
  buildCreators,
  buildCreatorDetail,
  type QueryPort,
} from "../aggregate.js";
import { validateStoryGraph, simulateStoryGraph, type SimulateInput } from "../storygraph.js";
import { buildMonetization } from "../monetization.js";
import { buildAnalytics, parseDim } from "../analytics.js";
import { buildGrowth } from "../growth.js";
import { buildModerationQueue, buildModerationPolicy } from "../moderation.js";
import { buildTrust } from "../trust.js";
import { buildFinance } from "../finance.js";
import { buildHealth } from "../health.js";
import { buildAuditPage, buildRolesView } from "../settings.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppDeps {
  db: QueryPort;
  verifier: OperatorVerifier;
  audit: AdminAuditSink;
}

// Hono context variable: the resolved operator identity, set by the auth middleware for downstream
// handlers and the audit helper.
type Vars = { operator: OperatorIdentity };

export function createAdminApp(deps: AppDeps): Hono {
  const app = new Hono<{ Variables: Vars }>();
  const { db, verifier, audit } = deps;

  // Console is a browser app on a different origin; identity rides the bearer token, not cookies.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );

  // AUTHN + RBAC middleware on every admin route. CORS preflight (OPTIONS) is handled above and never
  // reaches here. Sets the operator on the context for handlers and the audit seam.
  app.use("/admin/*", async (c, next) => {
    const token = parseBearer(c.req.header("authorization"));
    const operator = await verifier.verify(token);
    if (operator == null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const verdict = decide(operator.role, c.req.path, c.req.method);
    if (!verdict.allow) {
      return c.json({ error: "forbidden", reason: verdict.reason }, 403);
    }
    c.set("operator", operator);
    await next();
  });

  // GET /admin/me : the acting operator and role. Every authenticated operator may read their own
  // identity (the matrix grants `me` read to all roles).
  app.get("/admin/me", (c) => {
    const op = c.get("operator");
    return c.json({ operator: op.operatorId, role: op.role });
  });

  // GET /admin/dashboard : real hosted-data aggregates as KPI cards + topSeries bands + display-only
  // policy provenance.
  app.get("/admin/dashboard", async (c) => {
    const dashboard = await buildDashboard(db);
    return c.json(dashboard);
  });

  // GET /admin/content : the entity tree (channels -> series -> episodes) with status + a11y rollups.
  app.get("/admin/content", async (c) => {
    const tree = await buildContentTree(db);
    return c.json(tree);
  });

  // GET /admin/content/:id : a single series detail (graph rollup: episodes, beats, variants). A
  // malformed id is a clean 400 before any DB access; an unknown id is 404.
  app.get("/admin/content/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    const detail = await buildContentDetail(db, id);
    if (detail == null) return c.json({ error: "not_found" }, 404);
    return c.json(detail);
  });

  // GET /admin/story-graph/:seriesId : the versioned graph JSON composed from the hosted content graph
  // (series -> episodes -> beats -> beat_variants + beat_edges). A malformed id is a clean 400 before any
  // DB access; an unknown series is 404. Read-only; reward weights never appear here.
  app.get("/admin/story-graph/:seriesId", async (c) => {
    const id = c.req.param("seriesId");
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    const graph = await buildStoryGraph(db, id);
    if (graph == null) return c.json({ error: "not_found" }, 404);
    return c.json(graph);
  });

  // POST /admin/story-graph/:seriesId/validate : run the pure canon/broken-link constraint solver over the
  // composed graph and return { valid, issues[] }. Pure (no DB writes), but it is a POST mutation seam, so
  // it is RBAC-gated by the storyGraph write capability and the run is audit-logged for traceability.
  app.post("/admin/story-graph/:seriesId/validate", async (c) => {
    const id = c.req.param("seriesId");
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    const graph = await buildStoryGraph(db, id);
    if (graph == null) return c.json({ error: "not_found" }, 404);
    const result = validateStoryGraph(graph);
    await recordMutation(audit, c.get("operator"), "story_graph.validate", `series:${id}`, undefined, {
      valid: result.valid,
      issueCount: result.issues.length,
      version: graph.version,
    });
    return c.json(result);
  });

  // POST /admin/story-graph/:seriesId/simulate : deterministically walk the composed graph applying the
  // body's {path|signals} and return the visited node sequence. Pure (no DB writes); the same RBAC +
  // audit treatment as validate, since it is a POST seam.
  app.post("/admin/story-graph/:seriesId/simulate", async (c) => {
    const id = c.req.param("seriesId");
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    let body: SimulateInput = {};
    try {
      const raw = (await c.req.json()) as unknown;
      if (raw != null && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        body = {
          ...(Array.isArray(r.path) ? { path: r.path.filter((x): x is string => typeof x === "string") } : {}),
          ...(Array.isArray(r.signals) ? { signals: r.signals.filter((x): x is string => typeof x === "string") } : {}),
          ...(typeof r.start === "string" ? { start: r.start } : {}),
        };
      }
    } catch {
      // An empty or non-JSON body is a default signal-driven canon walk, not an error.
      body = {};
    }
    const graph = await buildStoryGraph(db, id);
    if (graph == null) return c.json({ error: "not_found" }, 404);
    const result = simulateStoryGraph(graph, body);
    await recordMutation(audit, c.get("operator"), "story_graph.simulate", `series:${id}`, undefined, {
      reachedEnding: result.reachedEnding,
      steps: result.visited.length,
      version: graph.version,
    });
    return c.json(result);
  });

  // GET /admin/media-factory/jobs : produce-DAG job state. No jobs table exists in the hosted schema yet,
  // so this returns an empty list with a clear shape + an "unwired" source marker (no fabricated jobs).
  app.get("/admin/media-factory/jobs", async (c) => {
    const jobs = await buildMediaFactoryJobs(db);
    return c.json(jobs);
  });

  // GET /admin/accessibility : per-series readiness (cc/ad/sign/dub coverage as a 0..100 score + blockers),
  // per-track QA placeholders, and a review-queue read (empty + unwired until a queue table exists).
  app.get("/admin/accessibility", async (c) => {
    const report = await buildAccessibility(db);
    return c.json(report);
  });

  // ---- Section 7-8: AD PLANE (brands / campaigns / placements) --------------------------------------
  // The hosted schema has no ad-plane tables yet (prompt 19). Each returns a real EMPTY list + source:
  // "unwired". RBAC scopes these to the ad-plane roles (Marketing/Admin/Owner write; others read). The
  // content/ad firewall holds: these handlers issue no content-ranking read.
  app.get("/admin/brands", async (c) => c.json(await buildBrands(db)));
  app.get("/admin/campaigns", async (c) => c.json(await buildCampaigns(db)));
  app.get("/admin/placements", async (c) => c.json(await buildPlacements(db)));

  // ---- Section 8: USERS (privacy-minimized viewer admin) --------------------------------------------
  // GET /admin/users : a minimized page (id/username/tier/created_at + wallet balance + event count). The
  // list read is access-logged via the audit sink as a read (who looked at the viewer roster, when). Query
  // params limit/offset page the list; the aggregate clamps them.
  app.get("/admin/users", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");
    const page = await buildUsersPage(db, Number.isFinite(limit) ? limit : 50, Number.isFinite(offset) ? offset : 0);
    await recordRead(audit, c.get("operator"), "users.list", "users", { count: page.users.length, total: page.total });
    return c.json(page);
  });

  // GET /admin/users/:id : the fuller (still minimized) profile. A malformed id is a clean 400 before any DB
  // access; an unknown id is 404. The detail read is access-logged (who looked at which viewer).
  app.get("/admin/users/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    const detail = await buildUserDetail(db, id);
    if (detail == null) return c.json({ error: "not_found" }, 404);
    await recordRead(audit, c.get("operator"), "users.detail", `user:${id}`);
    return c.json(detail);
  });

  // ---- Section 9: CREATORS ---------------------------------------------------------------------------
  // GET /admin/creators : derived from series ownership IF present, else empty + source:"unwired". The
  // 70/30 split is shown display-only via the revenueShare helper. No payout is executed.
  app.get("/admin/creators", async (c) => c.json(await buildCreators(db)));

  app.get("/admin/creators/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    const detail = await buildCreatorDetail(db, id);
    if (detail == null) return c.json({ error: "not_found" }, 404);
    return c.json(detail);
  });

  // ---- Section 10: MONETIZATION (pricing rules read model) ------------------------------------------
  // GET /admin/monetization : the documented default pricing-rules read model + observed ledger/prices.
  // Reward weights are returned DISPLAY-ONLY (a DRAFT constant, never editable). The live economy service
  // owns authoritative config; this never imports or edits it. RBAC: read-broad, finance-gated writes.
  app.get("/admin/monetization", async (c) => c.json(await buildMonetization(db)));

  // POST/PATCH /admin/monetization/pricing : pricing-edit AUDIT SEAM. RBAC gates this to the monetization
  // write roles (Finance/Admin/Owner) at the middleware. The mutation backend is unwired, so this audits
  // the attempt and returns 501 WITHOUT touching any data. A reward-weight edit is deliberately NOT a route
  // here: weights are a founder sign-off, surfaced display-only in the GET payload, never mutable.
  async function pricingEditSeam(c: Context<{ Variables: Vars }>): Promise<Response> {
    await recordMutation(audit, c.get("operator"), "monetization.pricing.edit", "pricing_rules", undefined, {
      executed: false,
      reason: "not_implemented",
    });
    return c.json(
      {
        error: "not_implemented",
        action: "monetization.pricing.edit",
        note: "pricing-edit backend is unwired; this seam audited the attempt and performed no config change. Reward weights are never editable (founder sign-off).",
      },
      501,
    );
  }
  app.post("/admin/monetization/pricing", (c) => pricingEditSeam(c));
  app.patch("/admin/monetization/pricing", (c) => pricingEditSeam(c));

  // ---- Section 11: ANALYTICS (canonical event-taxonomy dashboards) ----------------------------------
  // GET /admin/analytics?dim= : aggregate the event taxonomy into the requested dimension (default funnel).
  // Counterfactual / branch lift is returned as a BAND {low,high,center}, never a point. Read-broad RBAC.
  app.get("/admin/analytics", async (c) => {
    const dim = parseDim(c.req.query("dim"));
    return c.json(await buildAnalytics(db, dim));
  });

  // ---- Section 12: GROWTH (creative bandit / CAC-LTV bands / referral health) -----------------------
  // GET /admin/growth : creative-test win-rates (empty + unwired until a creative table exists), CAC/LTV/
  // payback as band estimates (unwired until a spend source lands), and referral-loop health from
  // mobile.referrals. RBAC: read-broad, Marketing-gated writes (no write route this slice).
  app.get("/admin/growth", async (c) => c.json(await buildGrowth(db)));

  // ---- Section 13: MODERATION (UGC queue + policy + scan seam + destructive seams) -------------------
  // GET /admin/moderation/queue : the UGC moderation queue. Empty + source:"unwired" until the social V8
  // tables (posts/comments/reports) exist; never fabricated items. The scan provider status is surfaced
  // (pending_provider while unwired). Read-broad (every operator reads); writes are the seams below.
  app.get("/admin/moderation/queue", async (c) => c.json(await buildModerationQueue(db)));

  // GET /admin/moderation/policy : the documented age-gate + rate-limit + community-rules read model. PURE
  // (no DB). The scan-provider coverage is reported honestly (pending_provider while unwired), never as a
  // clean enforcement of content that was not scanned.
  app.get("/admin/moderation/policy", (c) => c.json(buildModerationPolicy()));

  // POST /admin/moderation/items/:id/{approve|remove|escalate|block|takedown} : moderation action SEAMS.
  // RBAC gates these to the moderation write roles (Moderation/Admin/Owner) at the middleware. Each is a
  // 501 audit seam: it records the attempt (executed:false), touches NO data, and never invokes a scan
  // verdict (the scan provider stays pending_provider). A malformed id is a clean 400 before any audit.
  async function moderationSeam(c: Context<{ Variables: Vars }>, action: string): Promise<Response> {
    const id = c.req.param("id") ?? "";
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    await recordMutation(audit, c.get("operator"), action, `ugc:${id}`, undefined, {
      executed: false,
      reason: "not_implemented",
    });
    return c.json(
      {
        error: "not_implemented",
        action,
        note: "moderation action backend is unwired; this seam audited the attempt and performed no data change. CSAM/harassment scanning is pending_provider, never a fabricated verdict",
      },
      501,
    );
  }
  app.post("/admin/moderation/items/:id/approve", (c) => moderationSeam(c, "moderation.approve"));
  app.post("/admin/moderation/items/:id/remove", (c) => moderationSeam(c, "moderation.remove"));
  app.post("/admin/moderation/items/:id/escalate", (c) => moderationSeam(c, "moderation.escalate"));
  app.post("/admin/moderation/items/:id/block", (c) => moderationSeam(c, "moderation.block"));
  app.post("/admin/moderation/items/:id/takedown", (c) => moderationSeam(c, "moderation.takedown"));

  // ---- Section 14: TRUST (consent ledger minimized + C2PA provenance + GDPR queue) -------------------
  // GET /admin/trust/consent : the MINIMIZED consent-ledger view (scope/expiry/revocation only; no raw
  // biometric/PII; the sovereign plane is never returned in full). The read is access-logged (who looked at
  // the consent ledger, when), mirroring the user-admin privacy gate. Empty + unwired until a consent source
  // exists. GET /admin/trust/provenance : C2PA signing status per asset from the beat_variants substrate.
  // GET /admin/trust/gdpr : the GDPR data-subject-request queue (empty + unwired).
  app.get("/admin/trust/consent", async (c) => {
    const trust = await buildTrust(db);
    await recordRead(audit, c.get("operator"), "trust.consent.read", "consent_ledger", {
      entries: trust.consent.entries.length,
      source: trust.consent.source,
    });
    return c.json(trust.consent);
  });
  app.get("/admin/trust/provenance", async (c) => c.json((await buildTrust(db)).provenance));
  app.get("/admin/trust/gdpr", async (c) => c.json((await buildTrust(db)).gdpr));
  // GET /admin/trust : the composed consent + provenance + gdpr view. The consent block is access-logged.
  app.get("/admin/trust", async (c) => {
    const trust = await buildTrust(db);
    await recordRead(audit, c.get("operator"), "trust.consent.read", "consent_ledger", {
      entries: trust.consent.entries.length,
      source: trust.consent.source,
    });
    return c.json(trust);
  });

  // POST /admin/trust/consent/:id/delete and /admin/trust/gdpr/:id/delete : DESTRUCTIVE seams (consent
  // hard-delete, GDPR delete). RBAC gates these to Admin/Owner (the trust write surface). Each is a 501
  // audit seam: records the attempt (executed:false), touches NO consent/PII data. The audit `after` carries
  // only the intent, never any consent payload (the sovereign plane is never logged to the console trail).
  async function trustDeleteSeam(c: Context<{ Variables: Vars }>, action: string, targetPrefix: string): Promise<Response> {
    const id = c.req.param("id") ?? "";
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    await recordMutation(audit, c.get("operator"), action, `${targetPrefix}:${id}`, undefined, {
      executed: false,
      reason: "not_implemented",
    });
    return c.json(
      {
        error: "not_implemented",
        action,
        note: "trust hard-delete backend is unwired; this seam audited the attempt and performed no data change. Consent/biometric data stays on the sovereign plane and is never returned or deleted by this seam",
      },
      501,
    );
  }
  app.post("/admin/trust/consent/:id/delete", (c) => trustDeleteSeam(c, "trust.consent.hard_delete", "consent"));
  app.post("/admin/trust/gdpr/:id/delete", (c) => trustDeleteSeam(c, "trust.gdpr.delete", "subject"));

  // ---- Section 15: FINANCE (double-entry ledger + revenue + 70/30 payout accrual + FinOps) -----------
  // GET /admin/finance : the double-entry view composed from coin_transactions (ledger totals, revenue by
  // source), the creator 70/30 payout ACCRUAL (display-only via revenueShare; no payout executed), and a
  // FinOps cost read model. Stripe stays TEST; no live rail is invoked. Read-broad; payout-run is a seam.
  app.get("/admin/finance", async (c) => c.json(await buildFinance(db)));

  // POST /admin/finance/payouts/run : the payout-run SEAM. RBAC gates it to Finance/Owner (finance write).
  // 501 audit seam: records the attempt (executed:false), runs NO payout, invokes NO live Stripe rail.
  app.post("/admin/finance/payouts/run", async (c) => {
    await recordMutation(audit, c.get("operator"), "finance.payout.run", "payout_run", undefined, {
      executed: false,
      reason: "not_implemented",
    });
    return c.json(
      {
        error: "not_implemented",
        action: "finance.payout.run",
        note: "payout-run backend is unwired; this seam audited the attempt and ran no payout. The 70/30 accrual is display-only and Stripe stays TEST (no live rail invoked)",
      },
      501,
    );
  });

  // ---- Section 16: HEALTH (service-status registry) -------------------------------------------------
  // GET /admin/health : a STATIC service-status registry for the known services (the 5 live + the new
  // services) with QoE + error-rate placeholders, a job-failures block (unwired-honest: no jobs table), and
  // active alerts (empty + unwired). HARD RULE this wave: NO cross-service health ping is issued (the admin
  // API never calls the 5 live services); per-service liveness is honestly "unknown" + source:"unwired"
  // with a followup to wire real health checks. PURE (no DB, no fetch). RBAC: read Admin/Owner/Support only.
  app.get("/admin/health", (c) => c.json(buildHealth()));

  // ---- Section 17: SETTINGS (audit trail read + RBAC roles read model + flag toggle seam) ------------
  // GET /admin/settings/audit : a PAGED read of the immutable mobile.admin_audit_log, newest first. The
  // table is queued in scripts/sql/07_admin_audit.sql and may be unapplied; the read model probes for it and
  // returns empty + source:"unwired" when absent (audit rows are never fabricated). limit/offset page the
  // trail (clamped in the read model). The audit READ is broad (any operator may review who-did-what).
  app.get("/admin/settings/audit", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");
    return c.json(await buildAuditPage(db, limit, offset));
  });

  // GET /admin/settings/roles : the RBAC matrix as a read model derived from rbac.ts (the 8 roles x route
  // capabilities). PURE (no DB); the surfaced grid is the same MATRIX the decide() gate enforces, so it can
  // never drift from policy. Read-broad.
  app.get("/admin/settings/roles", (c) => c.json(buildRolesView()));

  // POST/PATCH /admin/settings/flags/:key : feature-flag TOGGLE audit seam. RBAC gates this to the settings
  // write roles (Owner/Admin) at the middleware. 501 audit seam: records the attempt (executed:false),
  // touches NO flag config. A flag toggle backend is unwired; surfacing the audited seam is the deliverable.
  async function flagToggleSeam(c: Context<{ Variables: Vars }>): Promise<Response> {
    const key = c.req.param("key") ?? "";
    await recordMutation(audit, c.get("operator"), "settings.flag.toggle", `flag:${key}`, undefined, {
      executed: false,
      reason: "not_implemented",
    });
    return c.json(
      {
        error: "not_implemented",
        action: "settings.flag.toggle",
        note: "feature-flag toggle backend is unwired; this seam audited the attempt and changed no flag config. Reward weights are never a feature flag (founder sign-off)",
      },
      501,
    );
  }
  app.post("/admin/settings/flags/:key", (c) => flagToggleSeam(c));
  app.patch("/admin/settings/flags/:key", (c) => flagToggleSeam(c));

  // ---- DESTRUCTIVE SEAMS (GDPR export/delete, ban, refund) ------------------------------------------
  // These are RBAC-gated by the elevated write surfaces (gdpr/moderation) in rbac.ts. They are PURE SEAMS
  // this wave: each appends ONE audit entry recording the attempted destructive action (who, what target,
  // intent), then returns 501 not_implemented WITHOUT touching any data. No delete, no ban, no refund is
  // executed. The mutation backend is unwired; surfacing the seam (audited) is the deliverable. The audit
  // entry is recorded BEFORE the 501 so the attempt is on the immutable trail even though nothing changed.
  async function destructiveSeam(c: Context<{ Variables: Vars }>, action: string): Promise<Response> {
    const id = c.req.param("id") ?? "";
    if (!UUID_RE.test(id)) return c.json({ error: "invalid_id" }, 400);
    await recordMutation(audit, c.get("operator"), action, `user:${id}`, undefined, {
      executed: false,
      reason: "not_implemented",
    });
    return c.json(
      {
        error: "not_implemented",
        action,
        note: "destructive mutation backend is unwired; this seam audited the attempt and performed no data change",
      },
      501,
    );
  }

  // GDPR export + delete (account-data operations; gdpr write = Admin/Owner).
  app.post("/admin/users/:id/export", (c) => destructiveSeam(c, "gdpr.export"));
  app.post("/admin/users/:id/delete", (c) => destructiveSeam(c, "gdpr.delete"));
  // Ban (moderation write = Moderation/Admin/Owner).
  app.post("/admin/users/:id/ban", (c) => destructiveSeam(c, "user.ban"));
  // Refund (moderation write = Finance/Moderation/Admin/Owner; a refund reverses a coin transaction).
  app.post("/admin/users/:id/refund", (c) => destructiveSeam(c, "coin.refund"));

  // Erase the context-variable generic at the boundary: callers (server.ts, tests) consume the plain Hono
  // fetch surface. The Vars typing exists only so the handlers above are type-safe against c.get/c.set.
  return app as unknown as Hono;
}

// The audit seam, exported for the first mutating route to call after a successful mutation. It is not
// invoked by any route in this read-only wave; it exists so the append-only trail is wired end to end the
// moment a mutation lands. Resolving the operator from the context keeps who-did-what honest.
export async function recordMutation(
  audit: AdminAuditSink,
  operator: OperatorIdentity,
  action: string,
  target: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  const entry: AuditEntry = {
    operatorId: operator.operatorId,
    role: operator.role,
    action,
    target,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  };
  await audit.append(entry);
}

// Access-log a sensitive READ. The user-admin reads touch viewer PII (minimized), so the privacy gate
// requires logging WHO accessed the viewer roster/profile and WHEN. This appends a read entry to the same
// immutable trail (action suffixed conceptually as a read; the `after` carries only non-PII metadata such
// as a count, never the rows themselves). It is a thin wrapper over recordMutation so there is one append
// path, but it exists as its own name so a reader sees these are access logs, not data mutations.
export async function recordRead(
  audit: AdminAuditSink,
  operator: OperatorIdentity,
  action: string,
  target: string,
  meta?: unknown,
): Promise<void> {
  await recordMutation(audit, operator, action, target, undefined, meta);
}

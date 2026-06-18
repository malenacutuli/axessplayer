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

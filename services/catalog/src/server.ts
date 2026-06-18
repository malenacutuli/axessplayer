// Production HTTP entry point for the catalog service. A NEW service (not deployed, not in render.yaml)
// implementing the CATALOG API CONTRACT against the hosted mobile schema. It mirrors the content service
// shape: a node:http listener bound HOST??0.0.0.0 / PORT??8099, a pg.Pool with DATABASE_URL + the
// DB_OPTIONS search_path=mobile,public so unqualified table names resolve to the mobile overlay, a Bearer
// session-token verifier stub mirroring services/decision/src/http/auth.ts, and a NODE_ENV=production
// hard-throw cutover gate consistent with the other services (the test verifier is refused in production;
// a real JWKS-backed verifier MUST be injected before serving prod). No em dashes.
//
// Endpoints (read-only except POST /calibrate):
//   POST /calibrate (authed)        merge into viewer_state.preference_vector, return payoff + 'CUT FOR YOU'
//   GET  /continue   (authed)       resume items from viewer_state progress + beats
//   GET  /trending                  engagement_events aggregation with a sparse-events fallback
//   GET  /series/:id/detail         series + episodes/beats + beat_variants, a11y chips derived from tracks
//   GET  /search?q=                 series titles, character names, channels
//
// Routing here is plain node:http (no framework dependency, matching the no-new-runtime-dep posture of the
// content bridge). The pure query builders in queries.ts carry the SQL and mapping and are unit-tested
// against a fake pg; this file only wires HTTP -> verifier -> builders -> pg.Pool.
//
// Env vars (must match the other services' infra/ENV.md conventions):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool.
//   DB_OPTIONS     public. e.g. "-c search_path=mobile,public" on the shared hosted project.
//   PORT           public. TCP port the listener binds. Defaults to 8099.
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images; triggers the verifier cutover gate.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";

import { parseBearer, testVerifiers, type Verifiers } from "./http/auth.js";
import {
  buildCalibrateUpsert,
  buildChannelHeaderQuery,
  buildChannelSeriesQuery,
  buildChannelsQuery,
  buildContinueQuery,
  buildSearchChannelsQuery,
  buildSearchCharactersQuery,
  buildSearchShowsQuery,
  buildSeriesA11yQuery,
  buildSeriesCutsQuery,
  buildSeriesEpisodesQuery,
  buildSeriesHeaderQuery,
  buildTrendingFallbackQuery,
  buildTrendingQuery,
  calibratePayoff,
  composeChannelDetail,
  composeSeriesDetail,
  mapChannelRows,
  mapContinueRows,
  mapSearchResults,
  mapSeriesCutsRows,
  mapTrendingRows,
  parseCalibrateInput,
  buildSeriesExistsQuery,
  buildGraphBeatsQuery,
  buildGraphVariantFlagsQuery,
  buildGraphEdgesQuery,
  composeSeriesGraph,
  buildBeatRetentionQuery,
  mapBeatRetention,
  buildBranchPerformanceQuery,
  mapBranchPerformance,
  buildEndingDistributionQuery,
  mapEndingDistribution,
  buildSeriesFunnelQuery,
  deriveSeriesFunnel,
  buildSeriesCompletionQuery,
  mapCompletion,
  buildCohortFunnelQuery,
  mapCohortSlices,
  buildSeriesRevenueBySourceQuery,
  buildSeriesRevenueByEpisodeQuery,
  buildSeriesRevenueByCohortQuery,
  buildSeriesPayoutBalanceQuery,
  composeSeriesRevenue,
  type SeriesAnalytics,
  type Queryable,
} from "./queries.js";

export interface CatalogServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  // Optional Postgres startup options, passed verbatim as the connection `options` parameter. On the
  // shared hosted project set DB_OPTIONS=-c search_path=mobile,public so unqualified names resolve to
  // `mobile`. Unset for local dev (default `public`).
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: the catalog reads the content graph
// and per-viewer state from Postgres, so there is nothing to serve without it.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CatalogServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("catalog server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// Choose the verifiers. CUTOVER GATE (consistent with services/decision): in production a real JWKS-backed
// Verifiers MUST be injected; the test verifier is refused there. Outside production the test verifier is
// wired for local/dev use.
export function selectVerifiers(cfg: CatalogServerConfig): Verifiers {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "catalog server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real Verifiers before running with NODE_ENV=production"
    );
  }
  return testVerifiers();
}

// Below the events count threshold, /trending falls back to recently published series so a fresh deployment
// with sparse traffic still shows a populated rail.
const TRENDING_MIN_ROWS = 3;

// ---------------------------------------------------------------------------------------------------
// Route handlers. Each returns a { status, body } pair; the bridge serializes it. The db is the narrow
// Queryable port (pg.Pool satisfies it). identity is the verified session subject for authed routes.
// ---------------------------------------------------------------------------------------------------

interface HandlerResult {
  status: number;
  body: unknown;
}

async function handleCalibrate(
  db: Queryable,
  userId: string,
  rawBody: unknown
): Promise<HandlerResult> {
  const input = parseCalibrateInput(rawBody);
  if (input == null) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const spec = buildCalibrateUpsert(userId, input);
  await db.query(spec.text, spec.values);
  return { status: 200, body: calibratePayoff(input) };
}

async function handleContinue(db: Queryable, userId: string): Promise<HandlerResult> {
  const spec = buildContinueQuery(userId);
  const r = await db.query(spec.text, spec.values);
  return { status: 200, body: mapContinueRows(r.rows) };
}

async function handleTrending(db: Queryable): Promise<HandlerResult> {
  const spec = buildTrendingQuery();
  const r = await db.query(spec.text, spec.values);
  let rows = r.rows;
  if (rows.length < TRENDING_MIN_ROWS) {
    const fb = buildTrendingFallbackQuery();
    const fbRes = await db.query(fb.text, fb.values);
    // Prefer the fallback only when it returns more than the sparse aggregation did, so a healthy
    // aggregation is never discarded for an emptier fallback.
    if (fbRes.rows.length > rows.length) rows = fbRes.rows;
  }
  return { status: 200, body: mapTrendingRows(rows) };
}

async function handleSeriesDetail(db: Queryable, seriesId: string): Promise<HandlerResult> {
  const header = buildSeriesHeaderQuery(seriesId);
  const episodes = buildSeriesEpisodesQuery(seriesId);
  const a11y = buildSeriesA11yQuery(seriesId);
  const [hRes, eRes, aRes] = await Promise.all([
    db.query(header.text, header.values),
    db.query(episodes.text, episodes.values),
    db.query(a11y.text, a11y.values),
  ]);
  const detail = composeSeriesDetail(hRes.rows, eRes.rows, aRes.rows);
  if (detail == null) {
    return { status: 404, body: { error: "not_found" } };
  }
  return { status: 200, body: detail };
}

async function handleSeriesCuts(db: Queryable, seriesId: string): Promise<HandlerResult> {
  const spec = buildSeriesCutsQuery(seriesId);
  const r = await db.query(spec.text, spec.values);
  // Read-only: the player marks owned cuts client-side using the wallet entitlements. A series with no
  // cut-bearing variants returns an empty array (not a 404): the resource exists, it just has no cuts.
  return { status: 200, body: mapSeriesCutsRows(r.rows) };
}

// CREATOR-SCOPED. Compose the branch-editor graph for the series. session-authed: the studio sends a
// creator session bearer; the route enforces the verified session before reaching here. A missing series
// is a 404 (composeSeriesGraph returns null).
async function handleSeriesGraph(db: Queryable, seriesId: string): Promise<HandlerResult> {
  const exists = buildSeriesExistsQuery(seriesId);
  const beats = buildGraphBeatsQuery(seriesId);
  const flags = buildGraphVariantFlagsQuery(seriesId);
  const edges = buildGraphEdgesQuery(seriesId);
  const [xRes, bRes, fRes, eRes] = await Promise.all([
    db.query(exists.text, exists.values),
    db.query(beats.text, beats.values),
    db.query(flags.text, flags.values),
    db.query(edges.text, edges.values),
  ]);
  const graph = composeSeriesGraph(seriesId, xRes.rows, bRes.rows, fRes.rows, eRes.rows);
  if (graph == null) return { status: 404, body: { error: "not_found" } };
  return { status: 200, body: graph };
}

// CREATOR-SCOPED. Aggregate the creator analytics for the series from engagement_events + decision_log +
// coin_transactions (reward-weights firewall: never reads or returns a reward weight). branchPerformance
// lift is always a BAND, never a point. A missing series is a 404.
async function handleSeriesAnalytics(db: Queryable, seriesId: string): Promise<HandlerResult> {
  const exists = buildSeriesExistsQuery(seriesId);
  const xRes = await db.query(exists.text, exists.values);
  if (xRes.rows[0] == null) return { status: 404, body: { error: "not_found" } };

  const retention = buildBeatRetentionQuery(seriesId);
  const branch = buildBranchPerformanceQuery(seriesId);
  const endings = buildEndingDistributionQuery(seriesId);
  const funnel = buildSeriesFunnelQuery(seriesId);
  const completion = buildSeriesCompletionQuery(seriesId);
  const cohort = buildCohortFunnelQuery(seriesId);
  const [rRes, brRes, enRes, fRes, cRes, coRes] = await Promise.all([
    db.query(retention.text, retention.values),
    db.query(branch.text, branch.values),
    db.query(endings.text, endings.values),
    db.query(funnel.text, funnel.values),
    db.query(completion.text, completion.values),
    db.query(cohort.text, cohort.values),
  ]);
  const comp = mapCompletion(cRes.rows);
  const body: SeriesAnalytics = {
    seriesId,
    beatRetention: mapBeatRetention(rRes.rows),
    branchPerformance: mapBranchPerformance(brRes.rows),
    endingDistribution: mapEndingDistribution(enRes.rows),
    funnel: deriveSeriesFunnel(fRes.rows[0] ?? {}),
    completion: comp.completion,
    watchTimeMs: comp.watchTimeMs,
    byCohort: mapCohortSlices(coRes.rows),
  };
  return { status: 200, body };
}

// CREATOR-SCOPED. Aggregate the series revenue from the coin_transactions ledger and apply the transparent
// 70/30 creator/platform split. session-authed: the studio sends a creator session bearer; the route
// enforces the verified session before any DB read. A missing series is a 404. Read-only / SELECT-only;
// never reads or returns a reward weight (reward-weights firewall) and never issues a charge.
async function handleSeriesRevenue(db: Queryable, seriesId: string): Promise<HandlerResult> {
  const exists = buildSeriesExistsQuery(seriesId);
  const xRes = await db.query(exists.text, exists.values);
  if (xRes.rows[0] == null) return { status: 404, body: { error: "not_found" } };

  const bySource = buildSeriesRevenueBySourceQuery(seriesId);
  const byEpisode = buildSeriesRevenueByEpisodeQuery(seriesId);
  const byCohort = buildSeriesRevenueByCohortQuery(seriesId);
  const payout = buildSeriesPayoutBalanceQuery(seriesId);
  const [sRes, eRes, cRes, pRes] = await Promise.all([
    db.query(bySource.text, bySource.values),
    db.query(byEpisode.text, byEpisode.values),
    db.query(byCohort.text, byCohort.values),
    db.query(payout.text, payout.values),
  ]);
  const body = composeSeriesRevenue(sRes.rows, eRes.rows, cRes.rows, pRes.rows);
  return { status: 200, body };
}

async function handleSearch(db: Queryable, q: string): Promise<HandlerResult> {
  const trimmed = q.trim();
  if (trimmed.length === 0) {
    return { status: 200, body: { shows: [], characters: [], channels: [] } };
  }
  const shows = buildSearchShowsQuery(trimmed);
  const characters = buildSearchCharactersQuery(trimmed);
  const channels = buildSearchChannelsQuery(trimmed);
  const [sRes, chRes, clRes] = await Promise.all([
    db.query(shows.text, shows.values),
    db.query(characters.text, characters.values),
    db.query(channels.text, channels.values),
  ]);
  return { status: 200, body: mapSearchResults(sRes.rows, chRes.rows, clRes.rows) };
}

async function handleChannels(db: Queryable): Promise<HandlerResult> {
  const spec = buildChannelsQuery();
  const r = await db.query(spec.text, spec.values);
  return { status: 200, body: mapChannelRows(r.rows) };
}

async function handleChannelDetail(db: Queryable, channelId: string): Promise<HandlerResult> {
  const header = buildChannelHeaderQuery(channelId);
  const series = buildChannelSeriesQuery(channelId);
  const [hRes, sRes] = await Promise.all([
    db.query(header.text, header.values),
    db.query(series.text, series.values),
  ]);
  const detail = composeChannelDetail(hRes.rows, sRes.rows);
  if (detail == null) {
    return { status: 404, body: { error: "not_found" } };
  }
  return { status: 200, body: detail };
}

// ---------------------------------------------------------------------------------------------------
// Request router. Dispatches by method + path, enforces the session trust boundary on the authed routes,
// and returns a structured 401/404/400 with the same no-store cache posture the other services use.
// ---------------------------------------------------------------------------------------------------

const SERIES_DETAIL_RE = /^\/series\/([^/]+)\/detail$/;
const SERIES_CUTS_RE = /^\/series\/([^/]+)\/cuts$/;
const SERIES_GRAPH_RE = /^\/series\/([^/]+)\/graph$/;
const SERIES_ANALYTICS_RE = /^\/series\/([^/]+)\/analytics$/;
const SERIES_REVENUE_RE = /^\/series\/([^/]+)\/revenue$/;
const CHANNEL_DETAIL_RE = /^\/channel\/([^/]+)$/;

export async function route(
  db: Queryable,
  verifiers: Verifiers,
  method: string,
  url: URL,
  authorization: string | null,
  rawBody: unknown
): Promise<HandlerResult> {
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return { status: 200, body: { ok: true } };
  }

  if (method === "POST" && path === "/calibrate") {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleCalibrate(db, identity.userId, rawBody);
  }

  if (method === "GET" && path === "/continue") {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleContinue(db, identity.userId);
  }

  if (method === "GET" && path === "/trending") {
    return handleTrending(db);
  }

  if (method === "GET" && path === "/search") {
    return handleSearch(db, url.searchParams.get("q") ?? "");
  }

  if (method === "GET" && path === "/channels") {
    return handleChannels(db);
  }

  const channelMatch = method === "GET" ? CHANNEL_DETAIL_RE.exec(path) : null;
  if (channelMatch != null) {
    return handleChannelDetail(db, decodeURIComponent(channelMatch[1]));
  }

  const detailMatch = method === "GET" ? SERIES_DETAIL_RE.exec(path) : null;
  if (detailMatch != null) {
    return handleSeriesDetail(db, decodeURIComponent(detailMatch[1]));
  }

  const cutsMatch = method === "GET" ? SERIES_CUTS_RE.exec(path) : null;
  if (cutsMatch != null) {
    return handleSeriesCuts(db, decodeURIComponent(cutsMatch[1]));
  }

  // CREATOR-SCOPED routes. session-authed: the studio sends a creator session bearer; an absent or invalid
  // token is a 401 before any series read. These compose the branch-editor graph and the creator analytics.
  const graphMatch = method === "GET" ? SERIES_GRAPH_RE.exec(path) : null;
  if (graphMatch != null) {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleSeriesGraph(db, decodeURIComponent(graphMatch[1]));
  }

  const analyticsMatch = method === "GET" ? SERIES_ANALYTICS_RE.exec(path) : null;
  if (analyticsMatch != null) {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleSeriesAnalytics(db, decodeURIComponent(analyticsMatch[1]));
  }

  const revenueMatch = method === "GET" ? SERIES_REVENUE_RE.exec(path) : null;
  if (revenueMatch != null) {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleSeriesRevenue(db, decodeURIComponent(revenueMatch[1]));
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------------------------------------
// node:http bridge. Mirrors services/content/src/server.ts: read the body, build a URL, dispatch through
// route(), write the JSON result with no-store caching. CORS is permissive so the browser consumer can
// call with its bearer token; no cookies.
// ---------------------------------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buf: Buffer): unknown {
  if (buf.length === 0) return undefined;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, accept",
};

// Bind the router to a real node:http server. host defaults to 0.0.0.0 for container reachability; port 0
// picks an ephemeral port (tests). Resolves with the server and bound port.
export function startServer(
  db: Queryable,
  verifiers: Verifiers,
  port = 0,
  host = "0.0.0.0"
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === "OPTIONS") {
          res.writeHead(204, CORS_HEADERS);
          res.end();
          return;
        }
        const body = parseJsonBody(await readBody(req));
        const host = req.headers.host ?? "catalog.local";
        const url = new URL(req.url ?? "/", `http://${host}`);
        const result = await route(
          db,
          verifiers,
          req.method ?? "GET",
          url,
          req.headers.authorization ?? null,
          body
        );
        res.writeHead(result.status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...CORS_HEADERS,
        });
        res.end(JSON.stringify(result.body));
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...CORS_HEADERS,
          });
        }
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

// Start the listener from the process environment. Called UNCONDITIONALLY by the guard-free entry file
// src/serve.ts. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const verifiers = selectVerifiers(cfg);
    const port = Number(process.env.PORT ?? 8099);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const { port: bound } = await startServer(pool, verifiers, port, host);
    // eslint-disable-next-line no-console
    console.log(`catalog service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start catalog server", err);
    process.exitCode = 1;
  }
}

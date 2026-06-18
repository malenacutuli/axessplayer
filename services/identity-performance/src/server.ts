// Production HTTP entry point for the identity-performance service. A NEW service (NOT deployed, NOT in
// render.yaml) implementing prompt 17 (identity + performance: face/identity lock, lip-sync, de-aging) on the
// SOVEREIGN plane. It mirrors the catalog service shape: a node:http listener bound HOST??0.0.0.0 /
// PORT??8106, a Bearer session + operator verifier stub (services/catalog/src/http/auth.ts), and a
// NODE_ENV=production hard-throw cutover gate consistent with the other services.
//
// SOVEREIGNTY BOUNDARY (hard): biometric reference data stays EU/Swiss and never leaves the sovereign plane.
// The reference embeddings/images live behind the IdentityStore on that plane only.
//
// FOUNDER CONSENT-ARCHITECTURE GATE (BUILT, NOT LIVE): SIGNED_OFF is false. While false, any REAL-LIKENESS
// operation (registering an identity with biometric references, lipsync, deage, scoring drift over real
// references) is REFUSED with "founder_consent_gate". This is never self-certified; only an explicit founder
// decision flips it.
//
// CONSENT (hard gate, P8): a real-likeness identity asset requires a CURRENT consent-ledger entry. Registering
// without current consent is refused; revocation HARD-DELETES the identity and its derived shots (purge path).
//
// Endpoints (PORT 8106):
//   POST /identities            register an identity (consent-gated + founder-gated for real-likeness)
//   GET  /identities/:id        fetch an identity's lock spec (biometric refs never returned to the client)
//   POST /score-drift           score identity across a character's shots, return score + flag
//   POST /lipsync               cost-gated per-language dub alignment (gated adapter, unwired -> no asset)
//   POST /deage                 cost-gated de-aging / performance preservation (gated adapter)
//   POST /revoke/:id            OPERATOR-only purge: revoke consent + hard-delete identity and derived shots
//
// Env vars (must match the other services' infra/ENV.md conventions):
//   DATABASE_URL   secret. Postgres connection string (sovereign plane) for the node-postgres Pool.
//   DB_OPTIONS     public. e.g. "-c search_path=mobile,public" on the shared hosted project.
//   PORT           public. TCP port the listener binds. Defaults to 8106.
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images; triggers the verifier cutover gate.
//
// No em dashes.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { parseBearer, testVerifiers, type Verifiers } from "./http/auth.js";
import { InMemoryConsentGate, type ConsentGate } from "./consent.js";
import {
  InMemoryIdentityStore,
  type IdentityStore,
  type IdentityReferences,
  type RegisterIdentityInput,
} from "./store.js";
import { buildLockSpec, scoreDrift, DRIFT_THRESHOLD } from "./identity.js";
import {
  defaultAdapterConfig,
  runDeage,
  runLipsync,
  type AdapterConfig,
} from "./adapters.js";

// FOUNDER CONSENT-ARCHITECTURE SIGN-OFF GATE. BUILT, NOT LIVE. While false, real-likeness operations are
// refused with "founder_consent_gate". NEVER self-certify: only an explicit founder decision flips this.
export const SIGNED_OFF = false;

export interface IdentityPerfDeps {
  store: IdentityStore;
  consent: ConsentGate;
  adapters: AdapterConfig;
}

export interface IdentityPerfServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: the sovereign identity store lives in
// Postgres, so there is nothing to serve without it.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityPerfServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("identity-performance server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// CUTOVER GATE (consistent with services/catalog): in production a real JWKS-backed Verifiers MUST be
// injected; the test verifier is refused there.
export function selectVerifiers(cfg: IdentityPerfServerConfig): Verifiers {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "identity-performance server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real Verifiers before running with NODE_ENV=production"
    );
  }
  return testVerifiers();
}

interface HandlerResult {
  status: number;
  body: unknown;
}

// ---------------------------------------------------------------------------------------------------
// input parsing (defensive; an invalid body is a 400, never a throw)
// ---------------------------------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asNumberMatrix(v: unknown): number[][] | null {
  if (!Array.isArray(v)) return null;
  const out: number[][] = [];
  for (const row of v) {
    if (!Array.isArray(row)) return null;
    const nums: number[] = [];
    for (const x of row) {
      if (typeof x !== "number" || !Number.isFinite(x)) return null;
      nums.push(x);
    }
    out.push(nums);
  }
  return out;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return null;
    out.push(x);
  }
  return out;
}

interface RegisterInput {
  input: RegisterIdentityInput;
}

// Parse a register request. references are OPTIONAL: an identity with no embeddings/images is a descriptive
// (non-real-likeness) lock and is NOT consent/founder gated for likeness. Presence of any embedding or image
// marks real-likeness.
function parseRegister(raw: unknown): RegisterInput | null {
  const r = asRecord(raw);
  if (r == null) return null;
  if (typeof r.seriesId !== "string" || r.seriesId.length === 0) return null;
  if (typeof r.characterName !== "string" || r.characterName.length === 0) return null;

  let embeddings: number[][] = [];
  let imageUrls: string[] = [];
  let voiceRef: string | null = null;

  if (r.referenceEmbeddings !== undefined) {
    const m = asNumberMatrix(r.referenceEmbeddings);
    if (m == null) return null;
    embeddings = m;
  }
  if (r.referenceImageUrls !== undefined) {
    const a = asStringArray(r.referenceImageUrls);
    if (a == null) return null;
    imageUrls = a;
  }
  if (r.voiceRef !== undefined) {
    if (r.voiceRef !== null && typeof r.voiceRef !== "string") return null;
    voiceRef = (r.voiceRef as string | null) ?? null;
  }
  const consentRef =
    r.consentRef === undefined || r.consentRef === null
      ? null
      : typeof r.consentRef === "string"
        ? r.consentRef
        : undefined;
  if (consentRef === undefined) return null;

  const references: IdentityReferences = { embeddings, imageUrls, voiceRef };
  const realLikeness = embeddings.length > 0 || imageUrls.length > 0 || voiceRef !== null;
  return { input: { seriesId: r.seriesId, characterName: r.characterName, references, consentRef, realLikeness } };
}

// ---------------------------------------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------------------------------------

// REGISTER. Real-likeness identities are double-gated: the founder sign-off gate AND a current consent-ledger
// entry. A descriptive (non-real-likeness) identity skips both likeness gates.
async function handleRegister(deps: IdentityPerfDeps, raw: unknown): Promise<HandlerResult> {
  const parsed = parseRegister(raw);
  if (parsed == null) return { status: 400, body: { error: "invalid_request" } };
  const { input } = parsed;

  if (input.realLikeness) {
    // FOUNDER GATE first: refuse real-likeness while not signed off, before touching consent or the store.
    if (!SIGNED_OFF) {
      return { status: 403, body: { error: "founder_consent_gate" } };
    }
    // CONSENT GATE (P8): a real-likeness asset requires a current consent-ledger entry.
    const state = await deps.consent.status(input.consentRef);
    if (!state.current) {
      return { status: 403, body: { error: "consent_required" } };
    }
  }

  const identity = await deps.store.register(input);
  return {
    status: 201,
    body: { id: identity.id, seriesId: identity.seriesId, characterName: identity.characterName, realLikeness: identity.realLikeness },
  };
}

// GET identity -> the lock spec for the model router. The raw biometric references are NEVER serialized to the
// client (sovereignty boundary); only the spec shape + counts. A real-likeness identity whose consent is no
// longer current is treated as UNREACHABLE (404) since its render precondition has lapsed.
async function handleGetIdentity(deps: IdentityPerfDeps, id: string): Promise<HandlerResult> {
  const identity = await deps.store.get(id);
  if (identity == null) return { status: 404, body: { error: "not_found" } };

  if (identity.realLikeness) {
    const state = await deps.consent.status(identity.consentRef);
    if (!state.current) {
      // Consent lapsed/revoked: the identity is unreachable for likeness rendering.
      return { status: 404, body: { error: "not_found" } };
    }
  }

  const spec = buildLockSpec(identity);
  return {
    status: 200,
    body: {
      identityId: spec.identityId,
      characterName: spec.characterName,
      strength: spec.strength,
      referenceEmbeddingCount: spec.referenceEmbeddings.length,
      referenceImageCount: spec.referenceImageUrls.length,
      hasVoiceRef: spec.voiceRef !== null,
      realLikeness: identity.realLikeness,
    },
  };
}

// SCORE DRIFT. Score identity across the character's shots and return the score + the human-review flag. For a
// real-likeness identity this reads biometric references, so it is founder + consent gated.
async function handleScoreDrift(deps: IdentityPerfDeps, raw: unknown): Promise<HandlerResult> {
  const r = asRecord(raw);
  if (r == null || typeof r.identityId !== "string" || r.identityId.length === 0) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const identity = await deps.store.get(r.identityId);
  if (identity == null) return { status: 404, body: { error: "not_found" } };

  if (identity.realLikeness) {
    if (!SIGNED_OFF) return { status: 403, body: { error: "founder_consent_gate" } };
    const state = await deps.consent.status(identity.consentRef);
    if (!state.current) return { status: 404, body: { error: "not_found" } };
  }

  const shots = await deps.store.listDerivedShots(identity.id);
  const report = scoreDrift(identity.references, shots, DRIFT_THRESHOLD, identity.id);
  return { status: 200, body: report };
}

// LIPSYNC / DEAGE: cost-gated adapter calls. Founder + consent gated (they operate on a real-likeness identity)
// and never fabricate an asset when unwired. A produced asset is recorded as a derived shot so the drift guard
// and the purge path see it.
async function handleAdapter(
  deps: IdentityPerfDeps,
  kind: "lipsync" | "deage",
  raw: unknown
): Promise<HandlerResult> {
  const r = asRecord(raw);
  if (r == null || typeof r.identityId !== "string" || r.identityId.length === 0) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const estimatedCost = typeof r.estimatedCost === "number" && Number.isFinite(r.estimatedCost) ? r.estimatedCost : 0;

  const identity = await deps.store.get(r.identityId);
  if (identity == null) return { status: 404, body: { error: "not_found" } };

  // These operations produce a real-likeness asset, so they are always likeness-gated.
  if (!SIGNED_OFF) return { status: 403, body: { error: "founder_consent_gate" } };
  const state = await deps.consent.status(identity.consentRef);
  if (!state.current) return { status: 403, body: { error: "consent_required" } };

  let result;
  if (kind === "lipsync") {
    const language = typeof r.language === "string" && r.language.length > 0 ? r.language : null;
    if (language == null) return { status: 400, body: { error: "invalid_request" } };
    result = await runLipsync(deps.adapters, { identityId: identity.id, language, estimatedCost });
  } else {
    const targetAgeDelta = typeof r.targetAgeDelta === "number" && Number.isFinite(r.targetAgeDelta) ? r.targetAgeDelta : null;
    if (targetAgeDelta == null) return { status: 400, body: { error: "invalid_request" } };
    result = await runDeage(deps.adapters, { identityId: identity.id, targetAgeDelta, estimatedCost });
  }

  // Only a real produced asset is recorded as a derived shot. Unwired/cost_gated produce nothing.
  if (result.status === "produced") {
    await deps.store.recordDerivedShot({
      identityId: identity.id,
      kind,
      embedding: result.embedding,
      assetUrl: result.assetUrl,
    });
  }
  const status = result.status === "produced" ? 200 : 422;
  return { status, body: result };
}

// REVOKE (OPERATOR-only). Revoke the consent and HARD-DELETE the identity and every derived shot (the purge
// path). Irreversible; the operator boundary is enforced in route(). Idempotent: purging an absent id reports
// identityDeleted=false.
async function handleRevoke(deps: IdentityPerfDeps, id: string): Promise<HandlerResult> {
  const identity = await deps.store.get(id);
  // Revoke at the consent layer first (best-effort: a stub gate exposes revoke; a trust-backed client would
  // append a withdrawal). Then hard-delete.
  if (identity?.consentRef != null && deps.consent instanceof InMemoryConsentGate) {
    deps.consent.revoke(identity.consentRef);
  }
  const purge = await deps.store.purge(id);
  return { status: 200, body: { revoked: true, ...purge } };
}

// ---------------------------------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------------------------------

const IDENTITY_RE = /^\/identities\/([^/]+)$/;
const REVOKE_RE = /^\/revoke\/([^/]+)$/;

export async function route(
  deps: IdentityPerfDeps,
  verifiers: Verifiers,
  method: string,
  url: URL,
  authorization: string | null,
  rawBody: unknown
): Promise<HandlerResult> {
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return { status: 200, body: { ok: true, signedOff: SIGNED_OFF } };
  }

  if (method === "POST" && path === "/identities") {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleRegister(deps, rawBody);
  }

  if (method === "POST" && path === "/score-drift") {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleScoreDrift(deps, rawBody);
  }

  if (method === "POST" && path === "/lipsync") {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleAdapter(deps, "lipsync", rawBody);
  }

  if (method === "POST" && path === "/deage") {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleAdapter(deps, "deage", rawBody);
  }

  const idMatch = method === "GET" ? IDENTITY_RE.exec(path) : null;
  if (idMatch != null) {
    const identity = await verifiers.session.verifySession(parseBearer(authorization));
    if (identity == null) return { status: 401, body: { error: "unauthorized" } };
    return handleGetIdentity(deps, decodeURIComponent(idMatch[1]));
  }

  // OPERATOR-only purge. Revocation hard-deletes biometric assets, so it requires an operator bearer, not a
  // viewer session.
  const revokeMatch = method === "POST" ? REVOKE_RE.exec(path) : null;
  if (revokeMatch != null) {
    const op = await verifiers.operator.verifyOperator(parseBearer(authorization));
    if (op == null) return { status: 401, body: { error: "unauthorized" } };
    return handleRevoke(deps, decodeURIComponent(revokeMatch[1]));
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------------------------------------
// node:http bridge (mirrors services/catalog/src/server.ts)
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

export function startServer(
  deps: IdentityPerfDeps,
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
        const host = req.headers.host ?? "identity-performance.local";
        const url = new URL(req.url ?? "/", `http://${host}`);
        const result = await route(
          deps,
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

// Build the default deps: the in-memory store + in-memory consent gate + unwired adapters. Production wiring
// swaps the store for a Postgres-backed one (sovereign plane) and the consent gate for a trust-backed client.
export function buildDefaultDeps(): IdentityPerfDeps {
  return {
    store: new InMemoryIdentityStore(),
    consent: new InMemoryConsentGate(),
    adapters: defaultAdapterConfig(),
  };
}

// Start the listener from the process environment. Called UNCONDITIONALLY by src/serve.ts.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const verifiers = selectVerifiers(cfg);
    const port = Number(process.env.PORT ?? 8106);
    const host = process.env.HOST ?? "0.0.0.0";
    // NOTE: production wiring replaces buildDefaultDeps() with a Postgres-backed sovereign store + trust gate.
    const deps = buildDefaultDeps();
    const { port: bound } = await startServer(deps, verifiers, port, host);
    // eslint-disable-next-line no-console
    console.log(`identity-performance service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start identity-performance server", err);
    process.exitCode = 1;
  }
}

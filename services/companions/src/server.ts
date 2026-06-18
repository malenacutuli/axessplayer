// Production HTTP entry point for the companions service. A NEW service (NOT deployed, NOT in render.yaml)
// implementing prompt 16 (AI companions: consented-actor character chat). It mirrors the shape of
// services/identity-performance/src/server.ts: a node:http listener bound HOST??0.0.0.0 / PORT??8109, a
// Bearer session + operator verifier stub, permissive CORS, and a NODE_ENV=production hard-throw cutover
// gate consistent with the other services.
//
// HIGHEST WELLBEING RISK, GATED. The gates, in order:
//
//   FOUNDER SIGN-OFF (BUILT, NOT LIVE): SIGNED_OFF is false. While false, EVERY companion is unreachable:
//     register, fetch, and message all refuse with "founder_signoff_required". Never self-certified; only an
//     explicit founder decision flips it. The whole surface is dark until then.
//   CONSENT (P8): a companion impersonates a real actor, so it requires a CURRENT likeness/voice consent
//     entry. Register without current consent is refused; fetch/message of a companion whose consent lapsed
//     is unreachable (404 / refused). Revocation HARD-DELETES the companion and its derived assets (purge).
//   AGE GATE: a minor session can never enter a mature/romantic mode; the mode is forced to general.
//   WELLBEING: a spend cool-down holds between paid actions; the grounding carries a persistent AI-character
//     disclosure and anti-dark-pattern rules; a usage-health break is suggested on long runs; the trust
//     meter is bounded and non-compulsive.
//   PROVENANCE: every synthetic turn is C2PA-signed + Article-50 labeled before it is persisted or returned.
//
// Endpoints (PORT 8109):
//   POST /companions          OPERATOR-only register (founder + consent gated)
//   GET  /companions/:id       fetch a companion (unreachable while unsigned or consent-lapsed)
//   POST /sessions/:id/message session subject chats (all gates apply; provenance-stamped synthetic turn)
//   POST /revoke/:id           OPERATOR-only: revoke consent + hard-delete companion and derived assets
//
// Env vars (must match the other services' infra/ENV.md conventions):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool (when wired).
//   DB_OPTIONS     public. e.g. "-c search_path=mobile,public" on the shared hosted project.
//   PORT           public. TCP port the listener binds. Defaults to 8109.
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images; triggers the verifier cutover gate.
//
// No em dashes.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { parseBearer, testVerifiers, type Verifiers } from "./http/auth.js";
import { InMemoryConsentGate, type ConsentGate } from "./consent.js";
import {
  InMemoryCompanionStore,
  type CompanionStore,
  type RegisterCompanionInput,
} from "./store.js";
import {
  buildSystemPrompt,
  advanceTrust,
  resolveMode,
  isUnlocked,
  shouldSuggestBreak,
  AI_DISCLOSURE,
  type Persona,
  type CompanionMode,
} from "./persona.js";
import { signTurn, AI_LABEL } from "./provenance.js";
import { defaultModelRouter, type ModelRouter, type CompletionMessage } from "./router.js";
import {
  defaultLedger,
  inSpendCooldown,
  nextCooldownUntil,
  royaltyIntentFromTerms,
  type LedgerPort,
} from "./spend.js";

// FOUNDER SIGN-OFF GATE. BUILT, NOT LIVE. While false, EVERY companion is unreachable (register, fetch,
// message all refuse). NEVER self-certify: only an explicit founder decision flips this. Companions are the
// highest-wellbeing-risk surface, so the entire plane stays dark until an explicit sign-off.
export const SIGNED_OFF = false;

export interface CompanionsDeps {
  store: CompanionStore;
  consent: ConsentGate;
  router: ModelRouter;
  ledger: LedgerPort;
}

export interface CompanionsServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: the companion store lives in Postgres
// once wired, so there is nothing to serve without it.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CompanionsServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("companions server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// CUTOVER GATE (consistent with the other services): in production a real JWKS-backed Verifiers MUST be
// injected; the test verifier is refused there.
export function selectVerifiers(cfg: CompanionsServerConfig): Verifiers {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "companions server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real Verifiers before running with NODE_ENV=production",
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

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return null;
    out.push(x);
  }
  return out;
}

function parsePersona(v: unknown, characterName: string): Persona | null {
  const r = asRecord(v) ?? {};
  const description = typeof r.description === "string" ? r.description : "";
  const traits = r.traits === undefined ? [] : asStringArray(r.traits);
  if (traits == null) return null;
  const maxMode: CompanionMode = r.maxMode === "mature" ? "mature" : "general";
  const unlockAtTrust =
    typeof r.unlockAtTrust === "number" && Number.isFinite(r.unlockAtTrust) && r.unlockAtTrust >= 0
      ? r.unlockAtTrust
      : 0;
  return { characterName, description, traits, maxMode, unlockAtTrust };
}

interface RegisterParsed {
  input: RegisterCompanionInput;
}

function parseRegister(raw: unknown): RegisterParsed | null {
  const r = asRecord(raw);
  if (r == null) return null;
  if (typeof r.seriesId !== "string" || r.seriesId.length === 0) return null;
  if (typeof r.characterName !== "string" || r.characterName.length === 0) return null;

  const persona = parsePersona(r.persona, r.characterName);
  if (persona == null) return null;

  const actorConsentRef =
    r.actorConsentRef === undefined || r.actorConsentRef === null
      ? null
      : typeof r.actorConsentRef === "string"
        ? r.actorConsentRef
        : undefined;
  if (actorConsentRef === undefined) return null;

  const voiceRef =
    r.voiceRef === undefined || r.voiceRef === null
      ? null
      : typeof r.voiceRef === "string"
        ? r.voiceRef
        : undefined;
  if (voiceRef === undefined) return null;

  const royaltyTerms = asRecord(r.royaltyTerms) ?? {};

  return {
    input: { seriesId: r.seriesId, characterName: r.characterName, actorConsentRef, persona, voiceRef, royaltyTerms },
  };
}

// ---------------------------------------------------------------------------------------------------
// route handlers. EVERY handler hits the founder sign-off gate first: while SIGNED_OFF=false the whole
// companion surface is unreachable.
// ---------------------------------------------------------------------------------------------------

// REGISTER (operator). Founder gate, then consent gate (a companion impersonates a real actor, so a CURRENT
// likeness/voice consent ref is required), then persist.
async function handleRegister(deps: CompanionsDeps, raw: unknown): Promise<HandlerResult> {
  if (!SIGNED_OFF) return { status: 403, body: { error: "founder_signoff_required" } };

  const parsed = parseRegister(raw);
  if (parsed == null) return { status: 400, body: { error: "invalid_request" } };
  const { input } = parsed;

  const state = await deps.consent.status(input.actorConsentRef);
  if (!state.current) return { status: 403, body: { error: "consent_required" } };

  const companion = await deps.store.register(input);
  return {
    status: 201,
    body: { id: companion.id, seriesId: companion.seriesId, characterName: companion.characterName, status: companion.status },
  };
}

// GET companion. Founder gate, then consent: a companion whose consent is absent or revoked is UNREACHABLE
// (404). The persistent AI-character disclosure is always surfaced. Raw consent/voice refs are not returned.
async function handleGetCompanion(deps: CompanionsDeps, id: string): Promise<HandlerResult> {
  if (!SIGNED_OFF) return { status: 403, body: { error: "founder_signoff_required" } };

  const companion = await deps.store.get(id);
  if (companion == null) return { status: 404, body: { error: "not_found" } };

  const state = await deps.consent.status(companion.actorConsentRef);
  if (!state.current) return { status: 404, body: { error: "not_found" } };

  return {
    status: 200,
    body: {
      id: companion.id,
      seriesId: companion.seriesId,
      characterName: companion.characterName,
      maxMode: companion.persona.maxMode,
      // Persistent AI-character disclosure: always present so the client cannot render a companion without it.
      ai_disclosure: AI_DISCLOSURE,
      is_ai_character: true,
    },
  };
}

// MESSAGE (session subject). The companion id is the :id in /sessions/:id/message (one logical session per
// (companion, user)). Order of gates: founder -> consent -> age/mode -> optional spend (cool-down) -> model
// -> provenance-stamp -> persist -> trust + memory update.
async function handleMessage(
  deps: CompanionsDeps,
  companionId: string,
  userId: string,
  isMinor: boolean,
  raw: unknown,
): Promise<HandlerResult> {
  if (!SIGNED_OFF) return { status: 403, body: { error: "founder_signoff_required" } };

  const r = asRecord(raw);
  if (r == null || typeof r.content !== "string" || r.content.length === 0) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const requestedMode: CompanionMode = r.mode === "mature" ? "mature" : "general";
  const wantsSpend = r.spend === true;
  const spendScopeId = typeof r.scopeId === "string" ? r.scopeId : "";
  const clientTxnId = typeof r.clientTxnId === "string" ? r.clientTxnId : "";

  const companion = await deps.store.get(companionId);
  if (companion == null) return { status: 404, body: { error: "not_found" } };

  // CONSENT: a companion whose consent lapsed is unreachable for chat too.
  const consentState = await deps.consent.status(companion.actorConsentRef);
  if (!consentState.current) return { status: 404, body: { error: "not_found" } };

  // AGE GATE: a minor can never enter a mature mode; resolveMode forces general and reports the block.
  const resolved = resolveMode(requestedMode, companion.persona, isMinor);
  if (resolved.ageBlocked) {
    return { status: 403, body: { error: "age_restricted_mode" } };
  }

  const session = await deps.store.getOrCreateSession(companionId, userId);

  // SPEND (optional, wellbeing-gated). The spend cool-down holds between paid actions: a session that just
  // spent cannot spend again until it elapses. Refused before any ledger call.
  let spendResult: { balance: number } | null = null;
  if (wantsSpend) {
    if (spendScopeId.length === 0 || clientTxnId.length === 0) {
      return { status: 400, body: { error: "invalid_request" } };
    }
    if (inSpendCooldown(session.spendCooldownUntil)) {
      return { status: 429, body: { error: "spend_cooldown" } };
    }
    // ACTOR ROYALTY: resolve the split from the companion's royalty_terms and pass it through the ledger
    // interface. The authoritative accrual lives in the economy/settlement planes, not owned here.
    const royalty = royaltyIntentFromTerms(companion.royaltyTerms);
    spendResult = await deps.ledger.spend({
      userId,
      scopeId: spendScopeId,
      clientTxnId,
      actorRoyaltyShare: royalty.share,
      actorPayeeRef: royalty.payeeRef,
    });
    session.spendCooldownUntil = nextCooldownUntil();
  }

  // GROUNDING: build the system prompt (always carries the AI disclosure + wellbeing rules), then call the
  // injected model router. An unwired router throws and the message is refused (never fabricated).
  const systemPrompt = buildSystemPrompt({
    persona: companion.persona,
    mode: resolved.mode,
    trustLevel: session.trustLevel,
  });
  const history: CompletionMessage[] = session.memory.map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: "user", content: r.content });

  const completion = await deps.router.complete({ system: systemPrompt, messages: history });

  // PROVENANCE: stamp the synthetic turn (C2PA TEST signer + Article-50 label) BEFORE persisting/returning.
  const now = new Date().toISOString();
  const manifest = signTurn({
    session_id: session.id,
    companion_id: companionId,
    content: completion.content,
    model: completion.model,
    created_at: now,
  });

  // Persist both turns. The synthetic turn carries the provenance material (never null for a companion turn).
  await deps.store.appendMessage({ sessionId: session.id, role: "user", content: r.content, c2paSignature: null, aiLabel: null });
  await deps.store.appendMessage({
    sessionId: session.id,
    role: "companion",
    content: completion.content,
    c2paSignature: manifest.signature,
    aiLabel: manifest.ai_label,
  });

  // Update per-user memory + the bounded trust meter + turn count, then save.
  session.memory.push({ role: "user", content: r.content });
  session.memory.push({ role: "companion", content: completion.content });
  session.trustLevel = advanceTrust(session.trustLevel);
  session.mode = resolved.mode;
  session.turns += 1;
  await deps.store.saveSession(session);

  return {
    status: 200,
    body: {
      reply: completion.content,
      // Provenance surfaced to the client so it can display the AI label on every synthetic turn.
      ai_label: AI_LABEL,
      c2pa_signature: manifest.signature,
      is_ai_character: true,
      mode: resolved.mode,
      trust_level: session.trustLevel,
      unlocked: isUnlocked(companion.persona, session.trustLevel),
      // Usage-health nudge (a wellbeing signal, never a retention mechanic).
      suggest_break: shouldSuggestBreak(session.turns),
      ...(spendResult != null ? { balance: spendResult.balance } : {}),
    },
  };
}

// REVOKE (operator). Revoke consent and HARD-DELETE the companion and every derived asset (sessions +
// messages). Irreversible; idempotent. Does NOT depend on SIGNED_OFF: a withdrawal must always be honoured,
// even while the surface is dark.
async function handleRevoke(deps: CompanionsDeps, id: string): Promise<HandlerResult> {
  const companion = await deps.store.get(id);
  if (companion?.actorConsentRef != null && deps.consent instanceof InMemoryConsentGate) {
    deps.consent.revoke(companion.actorConsentRef);
  }
  const purge = await deps.store.purge(id);
  return { status: 200, body: { revoked: true, ...purge } };
}

// ---------------------------------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------------------------------

const COMPANION_RE = /^\/companions\/([^/]+)$/;
const MESSAGE_RE = /^\/sessions\/([^/]+)\/message$/;
const REVOKE_RE = /^\/revoke\/([^/]+)$/;

export async function route(
  deps: CompanionsDeps,
  verifiers: Verifiers,
  method: string,
  url: URL,
  authorization: string | null,
  rawBody: unknown,
): Promise<HandlerResult> {
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return { status: 200, body: { ok: true, signedOff: SIGNED_OFF } };
  }

  // REGISTER is OPERATOR-only: it creates a consented-actor likeness asset.
  if (method === "POST" && path === "/companions") {
    const op = await verifiers.operator.verifyOperator(parseBearer(authorization));
    if (op == null) return { status: 401, body: { error: "unauthorized" } };
    return handleRegister(deps, rawBody);
  }

  const msgMatch = method === "POST" ? MESSAGE_RE.exec(path) : null;
  if (msgMatch != null) {
    const session = await verifiers.session.verifySession(parseBearer(authorization));
    if (session == null) return { status: 401, body: { error: "unauthorized" } };
    return handleMessage(deps, decodeURIComponent(msgMatch[1]), session.userId, session.isMinor, rawBody);
  }

  const getMatch = method === "GET" ? COMPANION_RE.exec(path) : null;
  if (getMatch != null) {
    const session = await verifiers.session.verifySession(parseBearer(authorization));
    if (session == null) return { status: 401, body: { error: "unauthorized" } };
    return handleGetCompanion(deps, decodeURIComponent(getMatch[1]));
  }

  // OPERATOR-only purge. Revocation hard-deletes consented-actor assets, so it requires an operator bearer.
  const revokeMatch = method === "POST" ? REVOKE_RE.exec(path) : null;
  if (revokeMatch != null) {
    const op = await verifiers.operator.verifyOperator(parseBearer(authorization));
    if (op == null) return { status: 401, body: { error: "unauthorized" } };
    return handleRevoke(deps, decodeURIComponent(revokeMatch[1]));
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------------------------------------
// node:http bridge (mirrors services/identity-performance/src/server.ts)
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
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, accept",
};

export function startServer(
  deps: CompanionsDeps,
  verifiers: Verifiers,
  port = 0,
  host = "0.0.0.0",
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
        const host = req.headers.host ?? "companions.local";
        const url = new URL(req.url ?? "/", `http://${host}`);
        const result = await route(
          deps,
          verifiers,
          req.method ?? "GET",
          url,
          req.headers.authorization ?? null,
          body,
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

// Build the default deps: in-memory store + in-memory consent gate + UNWIRED router + UNWIRED ledger.
// Production wiring swaps the store for a Postgres-backed one, the consent gate for a trust-backed client,
// the router for the platform model router, and the ledger for an economy-backed client.
export function buildDefaultDeps(): CompanionsDeps {
  return {
    store: new InMemoryCompanionStore(),
    consent: new InMemoryConsentGate(),
    router: defaultModelRouter(),
    ledger: defaultLedger(),
  };
}

// Start the listener from the process environment. Called UNCONDITIONALLY by src/serve.ts. selectVerifiers
// still throws under NODE_ENV=production, preserving the cutover hard stop.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const verifiers = selectVerifiers(cfg);
    const port = Number(process.env.PORT ?? 8109);
    const host = process.env.HOST ?? "0.0.0.0";
    const deps = buildDefaultDeps();
    const { port: bound } = await startServer(deps, verifiers, port, host);
    // eslint-disable-next-line no-console
    console.log(`companions service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start companions server", err);
    process.exitCode = 1;
  }
}

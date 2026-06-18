// The DELIGHT API handlers as PURE functions over an injected store + ports, so the node:http bridge is a
// thin shell and the contract is unit-testable. Routes (PORT 8107):
//   GET  /inbox/:userId            -> the viewer's inbox messages (self-scoped; AI disclosure on every one)
//   POST /inbox/:id/choose         -> "choose what I do next": applies a branch via the decision plane
//   POST /inbox/:id/clue           -> the PAID secret clue: spend cool-down + idempotent debit, then a clue
//   GET  /quest/:branchId          -> the viewer's quest progress for a branch
//   POST /quest/:branchId/contribute -> earn an unlock path (invite / watch_ad / spend / community_goal)
//
// TRUST: identity comes from the session bearer, never the body or path. /inbox/:userId is self-scoped: a
// caller may only read their OWN inbox, so the :userId must equal the session subject. No em dashes.

import {
  parseBearer,
  type SessionVerifier,
  type AgeGate,
  type EconomyDebit,
  type DecisionPlane,
  type ConsentLedger,
  type C2paSigner,
} from "./ports.js";
import {
  type DelightStore,
  type InboxMessage,
  type MessageKind,
} from "./store.js";
import {
  contributeToGoal,
  earnPath,
  isQuestPath,
  loadProgress,
  type QuestPath,
} from "./quest.js";

export interface ApiRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}
export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  store: DelightStore;
  verifier: SessionVerifier;
  ageGate: AgeGate;
  economy: EconomyDebit;
  decision: DecisionPlane;
  consent: ConsentLedger;
  c2pa: C2paSigner;
  // The paid-clue + spend-path cool-down window in milliseconds (anti-dark-pattern: prevents rapid-fire
  // spend). Injected so tests can use a small window. Defaults to 5 minutes.
  clueCooldownMs: number;
  // The credit price of a secret clue (server-authoritative; never trusted from the client).
  cluePriceCredits: number;
  // Clock seam for deterministic cool-down tests.
  now: () => number;
}

function source(store: DelightStore): "wired" | "unwired" {
  return store.wired ? "wired" : "unwired";
}
// ok: a success/response body with the store source tag attached.
function ok(status: number, store: DelightStore, body: Record<string, unknown>): ApiResponse {
  return { status, body: { ...body, source: source(store) } };
}
function err(status: number, error: string, extra: Record<string, unknown> = {}): ApiResponse {
  return { status, body: { error, ...extra } };
}

async function requireSubject(
  req: ApiRequest,
  verifier: SessionVerifier,
): Promise<{ userId: string } | ApiResponse> {
  const id = await verifier.verifySession(parseBearer(req.authorization));
  if (id == null) return err(401, "unauthenticated");
  return { userId: id.userId };
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

// The public projection of a message. ai_disclosure is ALWAYS present and true: the persistent
// "AI character" disclosure flag the client must show on every message. The consent_ref is not leaked.
function publicMessage(m: InboxMessage): Record<string, unknown> {
  return {
    id: m.id,
    thread_id: m.threadId,
    character_id: m.characterId,
    kind: m.kind,
    body: m.body,
    audio_url: m.audioUrl,
    branch_id: m.branchId,
    c2pa_ref: m.c2paRef,
    ai_disclosure: m.aiDisclosure, // structurally true: never cleared
    paid: m.paid,
    created_at: m.createdAt,
  };
}

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { store, verifier } = deps;

  if (req.path === "/health") {
    return ok(200, store, { ok: true, service: "delight" });
  }

  // GET /inbox/:userId
  if (req.path.startsWith("/inbox/")) {
    const rest = req.path.slice("/inbox/".length);

    // POST /inbox/:id/choose and POST /inbox/:id/clue
    if (rest.endsWith("/choose")) {
      if (req.method !== "POST") return err(405, "method_not_allowed");
      const subj = await requireSubject(req, verifier);
      if ("status" in subj) return subj;
      const threadId = decodeURIComponent(rest.slice(0, -"/choose".length));
      return chooseRoute(threadId, subj.userId, req, deps);
    }
    if (rest.endsWith("/clue")) {
      if (req.method !== "POST") return err(405, "method_not_allowed");
      const subj = await requireSubject(req, verifier);
      if ("status" in subj) return subj;
      const threadId = decodeURIComponent(rest.slice(0, -"/clue".length));
      return clueRoute(threadId, subj.userId, req, deps);
    }

    // GET /inbox/:userId (self-scoped)
    if (req.method !== "GET") return err(405, "method_not_allowed");
    const subj = await requireSubject(req, verifier);
    if ("status" in subj) return subj;
    const pathUserId = decodeURIComponent(rest);
    if (pathUserId !== subj.userId) return err(403, "forbidden");
    return inboxRoute(subj.userId, deps);
  }

  // /quest/:branchId and /quest/:branchId/contribute
  if (req.path.startsWith("/quest/")) {
    const rest = req.path.slice("/quest/".length);
    if (rest.endsWith("/contribute")) {
      if (req.method !== "POST") return err(405, "method_not_allowed");
      const subj = await requireSubject(req, verifier);
      if ("status" in subj) return subj;
      const branchId = decodeURIComponent(rest.slice(0, -"/contribute".length));
      return contributeRoute(branchId, subj.userId, req, deps);
    }
    if (req.method !== "GET") return err(405, "method_not_allowed");
    const subj = await requireSubject(req, verifier);
    if ("status" in subj) return subj;
    const branchId = decodeURIComponent(rest);
    if (branchId.length === 0) return err(400, "invalid_branch_id");
    return questRoute(branchId, subj.userId, deps);
  }

  return err(404, "not_found");
}

// GET /inbox/:userId: the viewer's messages, newest scripted beat last. Every message carries the AI
// disclosure flag (structurally true) and any C2PA signature for synthetic audio.
async function inboxRoute(userId: string, deps: ApiDeps): Promise<ApiResponse> {
  const messages = await deps.store.listMessages(userId);
  return ok(200, deps.store, {
    messages: messages.map(publicMessage),
    // A redundant, explicit assertion the client can rely on: the disclosure is always present.
    ai_disclosure_enforced: true,
  });
}

// POST /inbox/:id/choose: "choose what I do next". HARD age gate first (a minor is BLOCKED from a
// mature/romantic thread), then verify the actor consent is current, then apply the branch via the decision
// plane and append the in-character choose_next message (AI disclosure on it). NOT open-ended chat: the
// branch_id must be one the thread offers (validated minimally as a non-empty string here; the decision
// plane is the authority on validity).
async function chooseRoute(
  threadId: string,
  userId: string,
  req: ApiRequest,
  deps: ApiDeps,
): Promise<ApiResponse> {
  const thread = await deps.store.getThread(threadId);
  if (thread == null) return err(404, "thread_not_found");
  if (thread.userId !== userId) return err(403, "forbidden");

  const b = (req.body ?? {}) as Record<string, unknown>;
  const branchId = typeof b.branch_id === "string" ? b.branch_id.trim() : "";
  if (branchId.length === 0) return err(400, "invalid_branch_id");

  // HARD age gate: a minor (or unknown) is BLOCKED from a mature/romantic thread.
  const gate = await assertAgeAllowed(thread.matureMode, userId, deps);
  if (gate != null) return gate;

  // The choose_next beat must be grounded in a consented actor.
  const consentRef = typeof b.consent_ref === "string" ? b.consent_ref : null;
  if (!(await deps.consent.isCurrent(consentRef))) return err(409, "consent_not_current");

  const { nextVariantId } = await deps.decision.applyBranch({ userId, branchId });

  const msg: InboxMessage = {
    id: newId("msg"),
    threadId,
    userId,
    characterId: thread.characterId,
    kind: "choose_next",
    body: typeof b.body === "string" ? b.body : null,
    audioUrl: null,
    branchId,
    consentRef: consentRef as string,
    c2paRef: null,
    aiDisclosure: true,
    paid: false,
    createdAt: new Date(deps.now()).toISOString(),
  };
  await deps.store.appendMessage(msg);

  return ok(201, deps.store, {
    message: publicMessage(msg),
    next_variant_id: nextVariantId,
  });
}

// POST /inbox/:id/clue: the PAID secret clue. HARD age gate, consent gate, then the SPEND COOL-DOWN
// (anti-dark-pattern: no two clue purchases inside the window), then an IDEMPOTENT debit on client_txn_id
// (a replay does not double-charge). On success a secret_clue message is appended (paid, AI disclosure).
async function clueRoute(
  threadId: string,
  userId: string,
  req: ApiRequest,
  deps: ApiDeps,
): Promise<ApiResponse> {
  const thread = await deps.store.getThread(threadId);
  if (thread == null) return err(404, "thread_not_found");
  if (thread.userId !== userId) return err(403, "forbidden");

  const b = (req.body ?? {}) as Record<string, unknown>;
  const clientTxnId = typeof b.client_txn_id === "string" ? b.client_txn_id.trim() : "";
  if (clientTxnId.length === 0) return err(400, "missing_client_txn_id");

  const gate = await assertAgeAllowed(thread.matureMode, userId, deps);
  if (gate != null) return gate;

  const consentRef = typeof b.consent_ref === "string" ? b.consent_ref : null;
  if (!(await deps.consent.isCurrent(consentRef))) return err(409, "consent_not_current");

  const nowMs = deps.now();

  // Idempotency FIRST: a replay of a known client_txn_id returns the prior outcome without a second debit
  // and WITHOUT tripping the cool-down (the replay is the same purchase, not a new one).
  const prior = await deps.store.getClueSpendByTxn(clientTxnId);
  if (prior != null) {
    const balanceReplay = await deps.economy.debit(userId, deps.cluePriceCredits, clientTxnId);
    const clue = buildClueMessage(threadId, userId, thread.characterId, consentRef as string, b, nowMs);
    // Note: a replay does NOT append a second clue message; we just re-report the entitlement + balance.
    return ok(200, deps.store, {
      idempotent_replay: true,
      balance: balanceReplay.balance,
      clue_kind: clue.kind,
    });
  }

  // SPEND COOL-DOWN (anti-dark-pattern). A new purchase inside the window is refused (429), no charge.
  const last = await deps.store.lastClueSpendAt(userId);
  if (last != null && nowMs - last < deps.clueCooldownMs) {
    const retryAfterMs = deps.clueCooldownMs - (nowMs - last);
    return err(429, "spend_cooldown_active", { retry_after_ms: retryAfterMs });
  }

  // Debit (idempotent at the economy plane on client_txn_id). A paywall surfaces as insufficient_funds.
  let balance: number;
  try {
    const res = await deps.economy.debit(userId, deps.cluePriceCredits, clientTxnId);
    balance = res.balance;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/insufficient_funds/.test(m)) {
      return err(402, "insufficient_funds", { options: ["buy", "watch_ad", "subscribe"] });
    }
    throw e;
  }

  await deps.store.recordClueSpend({ clientTxnId, userId, threadId, atMs: nowMs });

  const clue = buildClueMessage(threadId, userId, thread.characterId, consentRef as string, b, nowMs);
  await deps.store.appendMessage(clue);

  return ok(201, deps.store, { message: publicMessage(clue), balance });
}

function buildClueMessage(
  threadId: string,
  userId: string,
  characterId: string,
  consentRef: string,
  b: Record<string, unknown>,
  nowMs: number,
): InboxMessage {
  return {
    id: newId("msg"),
    threadId,
    userId,
    characterId,
    kind: "secret_clue",
    body: typeof b.body === "string" ? b.body : "A secret clue for you.",
    audioUrl: null,
    branchId: typeof b.branch_id === "string" ? b.branch_id : null,
    consentRef,
    c2paRef: null,
    aiDisclosure: true,
    paid: true,
    createdAt: new Date(nowMs).toISOString(),
  };
}

// GET /quest/:branchId: the viewer's progress + the community goal snapshot for the branch.
async function questRoute(branchId: string, userId: string, deps: ApiDeps): Promise<ApiResponse> {
  const progress = await loadProgress(deps.store, userId, branchId, deps.now());
  const goal = await deps.store.getCommunityGoal(branchId);
  return ok(200, deps.store, {
    branch_id: branchId,
    unlocked: progress.unlocked,
    satisfied_path: progress.satisfiedPath,
    paths_seen: progress.pathsSeen,
    community_goal: goal
      ? { target: goal.targetCount, current: goal.currentCount, met: goal.met }
      : null,
  });
}

// POST /quest/:branchId/contribute: earn an unlock path. ANY path satisfies the unlock; the first one
// recorded flips unlocked. Each path is SERVER-VERIFIED:
//   * invite        : invitee_id + a first-watch verification token; NO self-referral (inviter != invitee).
//   * watch_ad      : an ad-completion token (server-verified shape here; production checks the SSV token).
//   * spend         : spend credits, idempotent on client_txn_id, respecting the spend cool-down.
//   * community_goal: contribute to the cross-viewer goal; when it is met the branch unlocks for everyone.
async function contributeRoute(
  branchId: string,
  userId: string,
  req: ApiRequest,
  deps: ApiDeps,
): Promise<ApiResponse> {
  if (branchId.length === 0) return err(400, "invalid_branch_id");
  const b = (req.body ?? {}) as Record<string, unknown>;
  const path = b.path;
  if (!isQuestPath(path)) return err(400, "invalid_path");

  const nowMs = deps.now();
  const progress = await loadProgress(deps.store, userId, branchId, nowMs);

  switch (path as QuestPath) {
    case "invite": {
      const inviteeId = typeof b.invitee_id === "string" ? b.invitee_id.trim() : "";
      const firstWatchToken = typeof b.first_watch_token === "string" ? b.first_watch_token.trim() : "";
      if (inviteeId.length === 0 || firstWatchToken.length === 0) {
        return err(400, "invite_requires_invitee_and_first_watch");
      }
      // NO self-referral: an inviter cannot be their own invitee. This grants NOTHING.
      if (inviteeId === userId) return err(409, "self_referral_forbidden");
      // SERVER-VERIFIED first-watch (shape stub: a non-empty token; production verifies it against the
      // economy grant interface idempotently). We treat the token as the idempotency key by folding it into
      // pathsSeen via earnPath (a repeated invite path is idempotent).
      break;
    }
    case "watch_ad": {
      const adToken = typeof b.ad_completion_token === "string" ? b.ad_completion_token.trim() : "";
      if (adToken.length === 0) return err(400, "watch_ad_requires_completion_token");
      break;
    }
    case "spend": {
      const clientTxnId = typeof b.client_txn_id === "string" ? b.client_txn_id.trim() : "";
      if (clientTxnId.length === 0) return err(400, "missing_client_txn_id");
      // Spend path respects the same cool-down as the paid clue (anti-dark-pattern), unless this is an
      // idempotent replay of a known txn.
      const prior = await deps.store.getClueSpendByTxn(clientTxnId);
      if (prior == null) {
        const last = await deps.store.lastClueSpendAt(userId);
        if (last != null && nowMs - last < deps.clueCooldownMs) {
          return err(429, "spend_cooldown_active", { retry_after_ms: deps.clueCooldownMs - (nowMs - last) });
        }
      }
      try {
        await deps.economy.debit(userId, deps.cluePriceCredits, clientTxnId);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (/insufficient_funds/.test(m)) {
          return err(402, "insufficient_funds", { options: ["buy", "watch_ad", "subscribe"] });
        }
        throw e;
      }
      if (prior == null) {
        await deps.store.recordClueSpend({ clientTxnId, userId, threadId: `quest:${branchId}`, atMs: nowMs });
      }
      break;
    }
    case "community_goal": {
      const goal = await deps.store.getCommunityGoal(branchId);
      if (goal == null) return err(404, "community_goal_not_found");
      // Contribute idempotently with the viewer as the contributor key: no self-referral inflation.
      const { goal: nextGoal, nowMet } = contributeToGoal(goal, userId);
      await deps.store.putCommunityGoal(nextGoal);
      // The branch unlocks for THIS viewer when the community goal is met (now or already). If it is not yet
      // met, the viewer's own progress is unchanged (no unlock from an unmet goal).
      if (nextGoal.met) {
        const unlocked = earnPath(progress, "community_goal", nowMs);
        await deps.store.putProgress(unlocked);
        return ok(200, deps.store, {
          branch_id: branchId,
          unlocked: unlocked.unlocked,
          satisfied_path: unlocked.satisfiedPath,
          paths_seen: unlocked.pathsSeen,
          community_goal: { target: nextGoal.targetCount, current: nextGoal.currentCount, met: nextGoal.met },
          newly_met: nowMet,
        });
      }
      // Not yet met: record nothing on the viewer's unlock; just report goal progress.
      await deps.store.putProgress(progress);
      return ok(200, deps.store, {
        branch_id: branchId,
        unlocked: progress.unlocked,
        satisfied_path: progress.satisfiedPath,
        paths_seen: progress.pathsSeen,
        community_goal: { target: nextGoal.targetCount, current: nextGoal.currentCount, met: nextGoal.met },
        newly_met: false,
      });
    }
  }

  // For invite / watch_ad / spend: earn the path (idempotent), which unlocks the branch.
  const next = earnPath(progress, path as QuestPath, nowMs);
  await deps.store.putProgress(next);
  return ok(200, deps.store, {
    branch_id: branchId,
    unlocked: next.unlocked,
    satisfied_path: next.satisfiedPath,
    paths_seen: next.pathsSeen,
  });
}

// HARD age gate. Returns an ApiResponse (the BLOCK) when the thread is mature/romantic and the viewer is a
// minor OR their age class is unknown (fail closed). Returns null when allowed. Server-enforced; the viewer
// age class is resolved from the identity plane, never the client.
async function assertAgeAllowed(
  matureMode: boolean,
  userId: string,
  deps: ApiDeps,
): Promise<ApiResponse | null> {
  if (!matureMode) return null;
  const ageClass = await deps.ageGate.ageClassOf(userId);
  if (ageClass !== "adult") {
    return err(403, "age_restricted", { mode: "mature" });
  }
  return null;
}

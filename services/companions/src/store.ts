// Companion store for the companions service. The narrow CompanionStore port is what the routes depend on;
// an in-memory implementation backs the tests and local wiring, and a Postgres-backed impl would wire to
// mobile.companions / companion_sessions / companion_messages (scripts/sql/15, QUEUED FOR APPLY).
//
// PURGE (hard, ties to consent revocation): a companion's derived assets are its sessions and its messages
// (the per-user memory + every synthetic turn). On consent revocation the purge path HARD-DELETES the
// companion AND everything derived from it, so no consented-actor likeness material survives a withdrawal.
// No em dashes.

import { randomUUID } from "node:crypto";

import type { Persona, CompanionMode } from "./persona.js";

export interface Companion {
  id: string;
  seriesId: string;
  characterName: string;
  actorConsentRef: string | null;
  persona: Persona;
  voiceRef: string | null;
  royaltyTerms: Record<string, unknown>;
  status: "draft" | "active" | "revoked";
  createdAt: string;
}

export interface CompanionSession {
  id: string;
  companionId: string;
  userId: string;
  trustLevel: number;
  mode: CompanionMode;
  // Per-user memory: the rolling turn window kept for grounding. Hard-deleted on purge.
  memory: { role: "user" | "companion"; content: string }[];
  // Wellbeing spend cool-down expiry (ISO), or null when the session has never spent.
  spendCooldownUntil: string | null;
  // Count of turns in this session, for the usage-health check.
  turns: number;
  createdAt: string;
}

export interface CompanionMessage {
  id: string;
  sessionId: string;
  role: "user" | "companion";
  content: string;
  // PROVENANCE: synthetic (companion) turns carry both. A synthetic turn missing either is never written.
  c2paSignature: string | null;
  aiLabel: string | null;
  createdAt: string;
}

export interface RegisterCompanionInput {
  seriesId: string;
  characterName: string;
  actorConsentRef: string | null;
  persona: Persona;
  voiceRef: string | null;
  royaltyTerms: Record<string, unknown>;
}

export interface PurgeResult {
  companionDeleted: boolean;
  sessionsDeleted: number;
  messagesDeleted: number;
}

export interface CompanionStore {
  register(input: RegisterCompanionInput): Promise<Companion>;
  get(id: string): Promise<Companion | null>;
  // Get an existing session for (companion, user), or create one. One session per (companion, user) keeps
  // memory and trust continuous for that pairing.
  getOrCreateSession(companionId: string, userId: string): Promise<CompanionSession>;
  getSession(sessionId: string): Promise<CompanionSession | null>;
  saveSession(session: CompanionSession): Promise<void>;
  appendMessage(msg: Omit<CompanionMessage, "id" | "createdAt">): Promise<CompanionMessage>;
  // HARD-DELETE the companion and every session + message derived from it. Idempotent: purging an absent id
  // is a no-op reporting companionDeleted=false.
  purge(id: string): Promise<PurgeResult>;
}

export class InMemoryCompanionStore implements CompanionStore {
  private readonly companions = new Map<string, Companion>();
  private readonly sessions = new Map<string, CompanionSession>();
  private readonly messages = new Map<string, CompanionMessage[]>(); // by sessionId

  async register(input: RegisterCompanionInput): Promise<Companion> {
    const id = randomUUID();
    const companion: Companion = {
      id,
      seriesId: input.seriesId,
      characterName: input.characterName,
      actorConsentRef: input.actorConsentRef,
      persona: input.persona,
      voiceRef: input.voiceRef,
      royaltyTerms: input.royaltyTerms,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.companions.set(id, companion);
    return companion;
  }

  async get(id: string): Promise<Companion | null> {
    return this.companions.get(id) ?? null;
  }

  async getOrCreateSession(companionId: string, userId: string): Promise<CompanionSession> {
    for (const s of this.sessions.values()) {
      if (s.companionId === companionId && s.userId === userId) return s;
    }
    const session: CompanionSession = {
      id: randomUUID(),
      companionId,
      userId,
      trustLevel: 0,
      mode: "general",
      memory: [],
      spendCooldownUntil: null,
      turns: 0,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    return session;
  }

  async getSession(sessionId: string): Promise<CompanionSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async saveSession(session: CompanionSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async appendMessage(msg: Omit<CompanionMessage, "id" | "createdAt">): Promise<CompanionMessage> {
    const full: CompanionMessage = { ...msg, id: randomUUID(), createdAt: new Date().toISOString() };
    const list = this.messages.get(msg.sessionId) ?? [];
    list.push(full);
    this.messages.set(msg.sessionId, list);
    return full;
  }

  async purge(id: string): Promise<PurgeResult> {
    const existed = this.companions.delete(id);
    let sessionsDeleted = 0;
    let messagesDeleted = 0;
    for (const [sid, s] of [...this.sessions.entries()]) {
      if (s.companionId !== id) continue;
      sessionsDeleted += 1;
      messagesDeleted += (this.messages.get(sid) ?? []).length;
      this.messages.delete(sid);
      this.sessions.delete(sid);
    }
    return { companionDeleted: existed, sessionsDeleted, messagesDeleted };
  }
}

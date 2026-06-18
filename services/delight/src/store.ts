// The DELIGHT store port + an in-memory implementation. The store is injected into the API so the contract
// is unit-testable offline and so a PgDelightStore (search_path=mobile) can be swapped in once
// scripts/sql/13_delight.sql is applied (CUTOVER GATE: SCHEMA). Until then `wired` is false and every
// payload carries source:"unwired". The store NEVER touches the live services' tables; it owns only the
// delight tables (inbox_threads, inbox_messages, quest_progress, community_goals). No em dashes.

export type MessageKind = "text" | "voice_note" | "secret_clue" | "choose_next";

export interface InboxThread {
  id: string;
  userId: string;
  characterId: string;
  seriesId: string | null;
  matureMode: boolean;
  createdAt: string;
}

export interface InboxMessage {
  id: string;
  threadId: string;
  userId: string;
  characterId: string;
  kind: MessageKind;
  body: string | null;
  audioUrl: string | null;
  branchId: string | null;
  consentRef: string;
  c2paRef: string | null;
  aiDisclosure: true; // structurally always true: the persistent "AI character" disclosure flag
  paid: boolean;
  createdAt: string;
}

export interface QuestProgress {
  userId: string;
  branchId: string;
  unlocked: boolean;
  satisfiedPath: string | null;
  pathsSeen: string[];
  updatedAt: string;
}

export interface CommunityGoal {
  branchId: string;
  targetCount: number;
  currentCount: number;
  contributors: string[];
  met: boolean;
}

// A recorded paid-clue spend, used by the in-memory store to enforce idempotency (one debit per
// client_txn_id) and the spend cool-down (no two clue purchases inside the window).
export interface ClueSpend {
  clientTxnId: string;
  userId: string;
  threadId: string;
  atMs: number;
}

export interface DelightStore {
  readonly wired: boolean;

  // inbox
  getThread(threadId: string): Promise<InboxThread | null>;
  putThread(thread: InboxThread): Promise<void>;
  listMessages(userId: string): Promise<InboxMessage[]>;
  appendMessage(msg: InboxMessage): Promise<void>;

  // paid-clue ledger (idempotency + cool-down support; the real debit is the economy plane by interface)
  getClueSpendByTxn(clientTxnId: string): Promise<ClueSpend | null>;
  lastClueSpendAt(userId: string): Promise<number | null>;
  recordClueSpend(spend: ClueSpend): Promise<void>;

  // quest
  getProgress(userId: string, branchId: string): Promise<QuestProgress | null>;
  putProgress(progress: QuestProgress): Promise<void>;
  getCommunityGoal(branchId: string): Promise<CommunityGoal | null>;
  putCommunityGoal(goal: CommunityGoal): Promise<void>;
}

export class InMemoryDelightStore implements DelightStore {
  readonly wired = false;

  private threads = new Map<string, InboxThread>();
  private messages: InboxMessage[] = [];
  private clueSpends: ClueSpend[] = [];
  private progress = new Map<string, QuestProgress>();
  private goals = new Map<string, CommunityGoal>();

  private progressKey(userId: string, branchId: string): string {
    return `${userId}::${branchId}`;
  }

  async getThread(threadId: string): Promise<InboxThread | null> {
    return this.threads.get(threadId) ?? null;
  }
  async putThread(thread: InboxThread): Promise<void> {
    this.threads.set(thread.id, thread);
  }
  async listMessages(userId: string): Promise<InboxMessage[]> {
    return this.messages
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async appendMessage(msg: InboxMessage): Promise<void> {
    this.messages.push(msg);
  }

  async getClueSpendByTxn(clientTxnId: string): Promise<ClueSpend | null> {
    return this.clueSpends.find((s) => s.clientTxnId === clientTxnId) ?? null;
  }
  async lastClueSpendAt(userId: string): Promise<number | null> {
    const mine = this.clueSpends.filter((s) => s.userId === userId);
    if (mine.length === 0) return null;
    return Math.max(...mine.map((s) => s.atMs));
  }
  async recordClueSpend(spend: ClueSpend): Promise<void> {
    this.clueSpends.push(spend);
  }

  async getProgress(userId: string, branchId: string): Promise<QuestProgress | null> {
    return this.progress.get(this.progressKey(userId, branchId)) ?? null;
  }
  async putProgress(progress: QuestProgress): Promise<void> {
    this.progress.set(this.progressKey(progress.userId, progress.branchId), progress);
  }
  async getCommunityGoal(branchId: string): Promise<CommunityGoal | null> {
    return this.goals.get(branchId) ?? null;
  }
  async putCommunityGoal(goal: CommunityGoal): Promise<void> {
    this.goals.set(goal.branchId, goal);
  }

  // Test seam: seed a community goal so a quest test can drive it to target.
  seedCommunityGoal(goal: CommunityGoal): void {
    this.goals.set(goal.branchId, goal);
  }
  // Test seam: seed a thread directly.
  seedThread(thread: InboxThread): void {
    this.threads.set(thread.id, thread);
  }
  seedMessage(msg: InboxMessage): void {
    this.messages.push(msg);
  }
}

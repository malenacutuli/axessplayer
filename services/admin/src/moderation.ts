// P9 moderation queue: a small, pure state machine. A flagged item is pending until a reviewer decides;
// the FIRST decision wins and a re-decision is an idempotent no-op (an audit log keeps the original
// reviewer and reason). No content is auto-removed without a human decision. No em dashes.

export type ModerationState = "pending" | "approved" | "rejected";

export type ModerationItem = {
  id: string;
  subjectId: string; // the beat_variant / series / channel under review
  kind: string; // why it was flagged (e.g. "user_report", "auto_safety")
  state: ModerationState;
  reviewer?: string;
  reason?: string;
  createdAt: string;
  decidedAt?: string;
};

export type ModerationDecision = { decision: "approved" | "rejected"; reviewer: string; reason?: string; at: string };

// Apply a decision. Only a pending item transitions; deciding an already-decided item returns it unchanged
// (idempotent, first decision wins) so a double-click or a replayed action cannot flip a ruling.
export function decide(item: ModerationItem, d: ModerationDecision): ModerationItem {
  if (item.state !== "pending") return item;
  if (d.reviewer.length === 0) throw new Error("moderation: a decision requires a reviewer");
  return { ...item, state: d.decision, reviewer: d.reviewer, reason: d.reason, decidedAt: d.at };
}

export function pendingQueue(items: ModerationItem[]): ModerationItem[] {
  return items.filter((i) => i.state === "pending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export type ModerationCounts = { pending: number; approved: number; rejected: number };
export function counts(items: ModerationItem[]): ModerationCounts {
  return {
    pending: items.filter((i) => i.state === "pending").length,
    approved: items.filter((i) => i.state === "approved").length,
    rejected: items.filter((i) => i.state === "rejected").length,
  };
}

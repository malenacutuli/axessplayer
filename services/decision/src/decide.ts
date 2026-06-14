// /decide handler for the walking skeleton. Wires policy.ts to the content graph and decision_log.
// Returns the decision_id (PF-2) and the prefetch hints (PF-6, client-side branching). The real
// sub-50ms serving, KV-cached viewer vectors, and the bandit are W3 work and need human sign-off.
// No em dashes.

import { assignControl, chooseBranch, type Candidate, type ViewerState } from "./policy.js";

export const POLICY_VERSION = "skeleton-0.1.0";

export type DecideRequest = {
  user_id: string;
  current_beat_id: string;
  signals?: { completion?: number; dwell_ms?: number; skipped?: boolean; choice?: string };
};

export type DecideResponse = {
  decision_id: string;
  next_variant_id: string;
  prefetch_variant_ids: string[];
  is_control: boolean;
  policy_version: string;
};

// Injected so the handler is testable. In the repo this is the Supabase service client.
export interface DecisionDB {
  seriesOfBeat(beatId: string): Promise<string>;
  successorsOf(beatId: string): Promise<Candidate[]>;     // resolved from beat_edges + beat_variants
  viewerState(userId: string, seriesId: string): Promise<ViewerState>;
  logDecision(row: {
    user_id: string;
    beat_id: string;
    served_variant_id: string;
    is_control: boolean;
    policy_version: string;
  }): Promise<string>;                                     // returns decision_log.id
}

export async function handleDecide(req: DecideRequest, db: DecisionDB): Promise<DecideResponse> {
  const candidates = await db.successorsOf(req.current_beat_id);
  if (candidates.length === 0) {
    throw new Error("no_successors"); // end of graph; caller serves the director's cut ending
  }
  const isControl = assignControl(req.user_id);
  const seriesId = await db.seriesOfBeat(req.current_beat_id);
  const viewer: ViewerState = isControl ? {} : await db.viewerState(req.user_id, seriesId);
  const chosen = chooseBranch(candidates, viewer, isControl);

  const decisionId = await db.logDecision({
    user_id: req.user_id,
    beat_id: req.current_beat_id,
    served_variant_id: chosen.variantId,
    is_control: isControl,
    policy_version: POLICY_VERSION,
  });

  return {
    decision_id: decisionId,
    next_variant_id: chosen.variantId,
    prefetch_variant_ids: candidates.map(c => c.variantId), // buffer all branch candidates for the seamless switch
    is_control: isControl,
    policy_version: POLICY_VERSION,
  };
}

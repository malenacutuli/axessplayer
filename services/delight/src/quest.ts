// Branch-as-quest domain logic (25-D4), as PURE functions over the store + ports. ANY of several earned
// paths unlocks a branch; the first to be satisfied flips unlocked and is recorded. The paths:
//   * invite        : SERVER-VERIFIED first-watch of an invitee, idempotent via the economy grant interface,
//                      NO self-referral (inviter != invitee).
//   * watch_ad      : SERVER-VERIFIED rewarded-ad completion (an ad-verification token, by interface).
//   * spend         : spend credits (the economy debit, idempotent on client_txn_id).
//   * community_goal: a progress bar aggregating contributions ACROSS viewers; when it reaches target, the
//                     branch unlocks for everyone.
//
// ANTI-DARK-PATTERN (hard, server-enforced): no manipulative streaks, no fear-of-loss countdowns, no
// artificial scarcity. A path is satisfied or it is not; nothing decays, nothing is lost, and there is no
// time pressure encoded here. A spend path respects the same cool-down as the paid clue. No em dashes.

import type { DelightStore, QuestProgress, CommunityGoal } from "./store.js";

export type QuestPath = "invite" | "watch_ad" | "spend" | "community_goal";

export const QUEST_PATHS: readonly QuestPath[] = ["invite", "watch_ad", "spend", "community_goal"];

export function isQuestPath(v: unknown): v is QuestPath {
  return typeof v === "string" && (QUEST_PATHS as readonly string[]).includes(v);
}

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

export function emptyProgress(userId: string, branchId: string, nowMs: number): QuestProgress {
  return {
    userId,
    branchId,
    unlocked: false,
    satisfiedPath: null,
    pathsSeen: [],
    updatedAt: nowIso(nowMs),
  };
}

// Record that a path was earned. Idempotent: a path already in pathsSeen does not flip anything twice. The
// FIRST path to be earned sets satisfiedPath and unlocked; later paths are still recorded (audit) but do not
// overwrite the satisfier. Returns the next progress state.
export function earnPath(progress: QuestProgress, path: QuestPath, nowMs: number): QuestProgress {
  if (progress.pathsSeen.includes(path)) return progress; // idempotent replay
  const pathsSeen = [...progress.pathsSeen, path];
  const alreadyUnlocked = progress.unlocked;
  return {
    ...progress,
    pathsSeen,
    unlocked: true,
    satisfiedPath: alreadyUnlocked ? progress.satisfiedPath : path,
    updatedAt: nowIso(nowMs),
  };
}

// Apply a community-goal contribution. Idempotent + NO self-referral inflation: a contributor key already
// in contributors does not advance the count. When current_count reaches target, met flips true. Returns the
// next goal state and whether THIS contribution caused the goal to be met for the first time.
export function contributeToGoal(
  goal: CommunityGoal,
  contributorKey: string,
): { goal: CommunityGoal; counted: boolean; nowMet: boolean } {
  if (goal.contributors.includes(contributorKey)) {
    return { goal, counted: false, nowMet: false }; // idempotent: already counted this contributor
  }
  const currentCount = goal.currentCount + 1;
  const met = currentCount >= goal.targetCount;
  const nowMet = met && !goal.met;
  return {
    goal: {
      ...goal,
      currentCount,
      contributors: [...goal.contributors, contributorKey],
      met,
    },
    counted: true,
    nowMet,
  };
}

// Load-or-create a viewer's progress for a branch.
export async function loadProgress(
  store: DelightStore,
  userId: string,
  branchId: string,
  nowMs: number,
): Promise<QuestProgress> {
  const existing = await store.getProgress(userId, branchId);
  return existing ?? emptyProgress(userId, branchId, nowMs);
}

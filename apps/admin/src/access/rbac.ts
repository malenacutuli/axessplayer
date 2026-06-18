// RBAC helper. The server enforces RBAC on every admin endpoint and writes every mutation to an immutable
// admin audit log; this client-side helper MIRRORS that policy so the UI never offers a control the
// operator cannot use. can(role, action) is the single gate the UI consults. Read-only viewers (ReadOnly)
// see a read-only UI. No em dashes.
//
// HARD GATES reflected here:
//   - reward-function weights are DISPLAY-ONLY for every role (a change is a founder sign-off, never an
//     operator/agent action), so there is no "policy.edit_reward_weights" action that any role can do.
//   - content/ad firewall and "no personal/biometric data leaves the sovereign plane" are enforced server
//     side; the UI simply never surfaces those crossings.
import type { OperatorRole } from "../api/adminApi";

// The actions the UI gates on. Mutating actions (anything ending in a verb other than "view") are also
// audit-logged server side. This wave is read-only, so the console only exercises the *.view actions; the
// mutating actions are declared so the matrix is complete and editing surfaces can light up later without
// a policy rewrite.
export type Action =
  | "dashboard.view"
  | "content.view"
  | "content.edit"
  | "content.publish"
  | "users.view"
  | "users.manage"
  | "creators.view"
  | "moderation.view"
  | "moderation.act"
  | "monetization.view"
  | "analytics.view"
  | "growth.view"
  | "billing.view"
  | "billing.payout"
  | "trust.view"
  | "health.view"
  | "settings.view"
  | "settings.manage"
  | "policy.view_reward_weights"; // DISPLAY ONLY, every role; never an edit action.

// Role -> allowed actions. "*" means all actions. ReadOnly gets only the *.view set (a read-only UI).
const VIEW_ACTIONS: Action[] = [
  "dashboard.view",
  "content.view",
  "users.view",
  "creators.view",
  "moderation.view",
  "monetization.view",
  "analytics.view",
  "growth.view",
  "billing.view",
  "trust.view",
  "health.view",
  "settings.view",
  "policy.view_reward_weights",
];

const MATRIX: Record<OperatorRole, Action[] | "*"> = {
  Owner: "*",
  Admin: "*",
  Content: [...VIEW_ACTIONS, "content.edit", "content.publish"],
  Finance: [...VIEW_ACTIONS, "billing.payout"],
  Marketing: [...VIEW_ACTIONS],
  Moderation: [...VIEW_ACTIONS, "moderation.act"],
  Support: [...VIEW_ACTIONS],
  ReadOnly: [...VIEW_ACTIONS],
};

export function can(role: OperatorRole, action: Action): boolean {
  const allowed = MATRIX[role];
  if (allowed === "*") return true;
  return allowed.includes(action);
}

// The mutating actions. A role that holds none of these renders a read-only UI. (policy.view_reward_weights
// is a READ action despite its suffix: reward weights are display-only for every role, never editable.)
const MUTATING_ACTIONS: Action[] = [
  "content.edit",
  "content.publish",
  "users.manage",
  "moderation.act",
  "billing.payout",
  "settings.manage",
];

// A read-only viewer cannot perform any mutating action. Used to render the whole UI read-only.
export function isReadOnly(role: OperatorRole): boolean {
  const allowed = MATRIX[role];
  if (allowed === "*") return false;
  return !MUTATING_ACTIONS.some((a) => allowed.includes(a));
}

// Moderation read model for GET /admin/moderation/queue and GET /admin/moderation/policy. Two blocks:
//   1. QUEUE. UGC moderation items (reports/comments/posts) are the SOCIAL V8 surface, which has no tables
//      in the hosted schema yet. This probes information_schema for the social tables and returns an EMPTY
//      typed queue + source:"unwired" with a followup when they are absent. Items are NEVER fabricated.
//      When the tables exist, the queue read is a data swap, not a shape change.
//   2. POLICY. The documented default moderation policy read model: the age-gate, the rate limits, and the
//      community rules. A constant with a source flag, surfaced read-only so the console renders the policy
//      without a live config service.
// The scan provider (scan.ts) is the CSAM/harassment seam: it returns "pending_provider", never a
// fabricated verdict. No em dashes.

import type { QueryPort } from "./aggregate.js";
import { socialTablesProbeSql, type Sql } from "./queries.js";
import { unwiredScanProvider, type ScanProvider, type ScanResult } from "./scan.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

// ---- Moderation queue -------------------------------------------------------------------------------

// One queued UGC moderation item. Empty in the unwired case (no social tables). scan carries the provider
// status: it is "pending_provider" until a real provider is wired, never a fabricated verdict.
export interface ModerationItem {
  id: string;
  kind: "post" | "comment" | "report";
  targetRef: string;
  reason: string;
  reportedAt: string;
  scan: ScanResult;
}

export interface ModerationQueueView {
  items: ModerationItem[];
  source: "unwired" | "hosted";
  note: string;
  // The scan provider identity, surfaced so the console shows that CSAM/harassment scanning is unwired
  // (pending_provider) rather than silently treating items as clean.
  scanProvider: string;
}

const QUEUE_UNWIRED_NOTE =
  "no UGC social tables (posts/comments/reports) in the hosted schema; the social V8 surface is not built yet, so the moderation queue is empty and unwired (items are never fabricated)";

// Build the moderation queue. Probes for the social tables; absent -> empty + unwired. When present, the
// item read is pending the social-source slice (returned as derived-source empty so a real read is a data
// swap, never fabricated rows). The scanProvider identity is always surfaced.
export async function buildModerationQueue(
  db: QueryPort,
  scanProvider: ScanProvider = unwiredScanProvider,
): Promise<ModerationQueueView> {
  const probe = await run<{ table_name: string }>(db, socialTablesProbeSql());
  if (probe.length === 0) {
    return { items: [], source: "unwired", note: QUEUE_UNWIRED_NOTE, scanProvider: scanProvider.name };
  }
  // A social table exists; reading + scanning real items is pending the social-source slice. Return
  // derived-source empty (structured so a real read is a data swap), never fabricated items.
  return {
    items: [],
    source: "hosted",
    note: "social UGC tables detected; queue read + per-item scan is pending the social-source slice",
    scanProvider: scanProvider.name,
  };
}

// ---- Moderation policy (documented default read model) ----------------------------------------------

export interface AgeGatePolicy {
  // The minimum age to view UGC and the minimum age to post UGC. A documented default; a hosted config read
  // swaps source to "hosted" without a shape change.
  minViewAge: number;
  minPostAge: number;
  note: string;
}

export interface RateLimitPolicy {
  // Documented default UGC rate limits, per window, so the console renders the throttle config.
  postsPerHour: number;
  commentsPerHour: number;
  reportsPerDay: number;
}

export interface CommunityRule {
  id: string;
  label: string;
  description: string;
}

export interface ModerationPolicyView {
  ageGate: AgeGatePolicy;
  rateLimits: RateLimitPolicy;
  communityRules: CommunityRule[];
  // The scan-provider coverage, display-only: which scan kinds a real provider WOULD enforce, and the
  // current (unwired) status, so the policy view never implies content is being scanned when it is not.
  scanProvider: { name: string; status: ScanResult["status"]; note: string };
  source: "default";
  note: string;
}

// The documented default community rules. Read-only product policy, surfaced so the console has a complete
// rule list even though a live policy service owns the authoritative config.
export const DEFAULT_COMMUNITY_RULES: CommunityRule[] = [
  { id: "no_csam", label: "No child sexual abuse material", description: "CSAM and illegal content are removed and reported; a wired scan provider enforces detection" },
  { id: "no_harassment", label: "No harassment or abuse", description: "Targeted harassment, threats, and abuse are removed" },
  { id: "no_hate", label: "No hate speech", description: "Content attacking protected groups is removed" },
  { id: "no_spam", label: "No spam", description: "Repeated unsolicited or deceptive content is rate-limited and removed" },
  { id: "age_appropriate", label: "Age-appropriate posting", description: "UGC must respect the age gate; under-age accounts cannot view or post mature UGC" },
];

export const DEFAULT_AGE_GATE: AgeGatePolicy = {
  minViewAge: 13,
  minPostAge: 13,
  note: "documented default age gate; a regional/COPPA-aware config swaps source to hosted when wired",
};

export const DEFAULT_RATE_LIMITS: RateLimitPolicy = {
  postsPerHour: 10,
  commentsPerHour: 60,
  reportsPerDay: 50,
};

// Build the policy read model. PURE: no DB access (the policy is a documented default constant). The scan
// provider status is read from the provider so the policy honestly reflects the unwired state.
export function buildModerationPolicy(scanProvider: ScanProvider = unwiredScanProvider): ModerationPolicyView {
  return {
    ageGate: DEFAULT_AGE_GATE,
    rateLimits: DEFAULT_RATE_LIMITS,
    communityRules: DEFAULT_COMMUNITY_RULES,
    scanProvider: {
      name: scanProvider.name,
      // The policy view reports the unwired scanner as pending_provider, never as a clean enforcement.
      status: scanProvider === unwiredScanProvider ? "pending_provider" : "clean",
      note:
        scanProvider === unwiredScanProvider
          ? "scan provider is unwired; CSAM/harassment scanning returns pending_provider, never a clean/blocked verdict"
          : "a scan provider is wired; per-item verdicts come from the provider",
    },
    source: "default",
    note: "moderation policy is the documented default read model; a live policy service owns authoritative config",
  };
}

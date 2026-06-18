// Growth read model for GET /admin/growth. Three blocks:
//   1. CREATIVE-TEST BANDIT win-rates. The hosted schema has no creative-experiment table, so this probes
//      the catalog and returns an EMPTY typed shape + source:"unwired" with a followup, never fabricated
//      win-rates. The shape mirrors the services/experiment win-rate framing (a directional band per arm),
//      so wiring a real creative table is a data swap, not a shape change.
//   2. CAC / LTV / payback by channel/cohort. There is no spend/attribution source in the hosted schema, so
//      these are returned as BAND ESTIMATES {low,high,center} (never points), seeded as empty/unwired with
//      a source flag. Bands are the only sanctioned framing for these high-variance projections.
//   3. REFERRAL-LOOP HEALTH from mobile.referrals: counts by status (invited/joined/first_watch) and the
//      reward_granted count. reward_granted is a NEUTRAL bookkeeping flag, never an optimization target.
// No em dashes.

import type { QueryPort } from "./aggregate.js";
import { referralHealthSql, creativeExperimentTableProbeSql, type Sql } from "./queries.js";
import type { Band } from "./bands.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ---- Creative bandit win-rates --------------------------------------------------------------------

export interface CreativeArm {
  armId: string;
  // Directional win-rate band vs the control creative. Always a band; never a point. Empty in the unwired
  // case (no arms to report).
  winRate: Band;
  direction: "up" | "down" | "none";
}
export interface CreativeBanditView {
  arms: CreativeArm[];
  source: "unwired" | "hosted";
  note: string;
}

const CREATIVE_UNWIRED_NOTE =
  "no creative-experiment table in the hosted schema; wire the services/experiment creative-test source before reporting win-rates";

export async function buildCreativeBandit(db: QueryPort): Promise<CreativeBanditView> {
  const probe = await run<{ table_name: string }>(db, creativeExperimentTableProbeSql());
  // No creative table -> empty + unwired, never fabricated arms.
  if (probe.length === 0) {
    return { arms: [], source: "unwired", note: CREATIVE_UNWIRED_NOTE };
  }
  // A table exists; deriving its win-rate bands is pending the creative-source slice. Return derived-source
  // empty (structured so a real read is a data swap), never fabricated.
  return {
    arms: [],
    source: "hosted",
    note: "creative-experiment table detected; win-rate band derivation is pending the creative-source slice",
  };
}

// ---- CAC / LTV / payback (BAND estimates, never points) -------------------------------------------

export interface ChannelEconomics {
  channel: string;
  // All three are bands: CAC/LTV are high-variance estimates, paybackDays is derived from them, so a point
  // would imply false confidence. Empty/unwired -> degenerate zero bands flagged by source.
  cac: Band;
  ltv: Band;
  paybackDays: Band;
}
export interface AcquisitionView {
  channels: ChannelEconomics[];
  source: "unwired" | "hosted";
  note: string;
}

const ACQUISITION_UNWIRED_NOTE =
  "no ad-spend / attribution source in the hosted schema; CAC/LTV/payback are band estimates and are unwired until a spend + attribution source lands";

export async function buildAcquisition(_db: QueryPort): Promise<AcquisitionView> {
  // No spend or attribution data exists; do NOT fabricate CAC/LTV. Empty + unwired is the honest answer.
  // _db is accepted so the signature is stable once a spend source is wired.
  void _db;
  return { channels: [], source: "unwired", note: ACQUISITION_UNWIRED_NOTE };
}

// ---- Referral-loop health -------------------------------------------------------------------------

export interface ReferralHealth {
  invited: number;
  joined: number;
  firstWatch: number;
  rewardGranted: number;
  total: number;
  // Funnel conversions, 0..1, derived from the counts. invited->joined and joined->first_watch. Zero
  // denominators yield 0 (never NaN), so a fresh loop with no invites is honestly 0, not undefined.
  joinRate: number;
  firstWatchRate: number;
}

interface ReferralRow {
  invited: number;
  joined: number;
  first_watch: number;
  reward_granted: number;
  total: number;
}

// Fold the referral status counts into the health view + funnel rates. Pure: it takes the row and derives
// the rates so the aggregation is unit-testable without a DB.
export function deriveReferralHealth(row: ReferralRow | undefined): ReferralHealth {
  const r = row ?? { invited: 0, joined: 0, first_watch: 0, reward_granted: 0, total: 0 };
  const invited = num(r.invited);
  const joined = num(r.joined);
  const firstWatch = num(r.first_watch);
  // The status funnel: invited is the entry; an invite that progressed is no longer in the invited bucket,
  // so the join denominator is the whole loop's reach (invited + joined + first_watch), and the
  // first-watch denominator is everyone who at least joined.
  const reached = invited + joined + firstWatch;
  const atLeastJoined = joined + firstWatch;
  return {
    invited,
    joined,
    firstWatch,
    rewardGranted: num(r.reward_granted),
    total: num(r.total),
    joinRate: reached > 0 ? atLeastJoined / reached : 0,
    firstWatchRate: atLeastJoined > 0 ? firstWatch / atLeastJoined : 0,
  };
}

export async function buildReferralHealth(db: QueryPort): Promise<ReferralHealth> {
  const rows = await run<ReferralRow>(db, referralHealthSql());
  return deriveReferralHealth(rows[0]);
}

// ---- Growth view (the GET /admin/growth payload) ---------------------------------------------------

export interface GrowthView {
  creativeBandit: CreativeBanditView;
  acquisition: AcquisitionView;
  referrals: ReferralHealth;
}

export async function buildGrowth(db: QueryPort): Promise<GrowthView> {
  const [creativeBandit, acquisition, referrals] = await Promise.all([
    buildCreativeBandit(db),
    buildAcquisition(db),
    buildReferralHealth(db),
  ]);
  return { creativeBandit, acquisition, referrals };
}

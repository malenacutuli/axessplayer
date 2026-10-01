// Canonical analytics event taxonomy for the Axessplayer adaptive cinema stack.
//
// Source of truth: docs/product/GOLD_STANDARD_13_VARIANT_SUBSTRATE_AND_EVENTS.md (section 2).
// Every viewer action emits exactly one of these events to the events stream. The stream is
// idempotent on sessionId + eventId and feeds BOTH the recommender and the adaptive engine
// (one stream, tagged per consumer). No em dashes anywhere by project rule.
//
// This file is ADDITIVE: it does not edit the frozen contracts/events schema. It captures the
// GOLD_STANDARD_13 canonical set as a TypeScript string-literal union so surfaces (10 viewer,
// 11 admin, 12 studio) can emit and aggregate with one shared name space.

/**
 * AxpEventName is the canonical, closed set of analytics event names.
 *
 * The order mirrors GOLD_STANDARD_13 section 2 for auditability. Adding or removing a member
 * here is a contract change and must be reflected in the doc.
 */
export type AxpEventName =
  // funnel and lifecycle
  | "impression"
  | "play"
  | "view_3s"
  | "completion_50"
  | "episode_completed"
  // beat and branch
  | "beat_started"
  | "beat_completed"
  | "branch_shown"
  | "branch_selected"
  | "countdown_expired"
  // adaptive cut selection
  | "cut_switched"
  | "pov_selected"
  | "intensity_selected"
  | "language_switched"
  // accessibility and ad toggles
  | "caption_toggled"
  | "ad_toggled"
  | "sign_toggled"
  // monetization surfaces
  | "unlock_shown"
  | "unlock_purchased"
  | "premium_cut_shown"
  | "premium_cut_purchased"
  // credits and economy
  | "credits_earned"
  | "credits_spent"
  | "ad_watched"
  | "checkin"
  | "follow_bonus"
  // subscription and paywall
  | "subscription_started"
  | "subscription_canceled"
  | "paywall_presented"
  // library and social
  | "save"
  | "unsave"
  | "favorite"
  | "character_followed"
  | "channel_followed"
  | "comment_posted"
  | "comment_liked"
  | "post_liked"
  | "share"
  // invite loop
  | "invite_sent"
  | "invite_joined"
  | "invite_first_watch"
  // offline
  | "download_started"
  | "download_completed"
  | "offline_watched"
  // discovery and resume
  | "search_performed"
  | "series_opened"
  | "continue_resumed"
  // reading platform (prompt 28): the demand sensor input on the shared engagement stream. work_id +
  // chapter_index ride in props, so reading behavior aggregates like video with no new table.
  | "chapter_started"
  | "chapter_completed"
  | "work_finished"
  | "chapter_reread"
  | "work_shared"
  | "work_followed"
  // platform v2 video, sponsorship, ads, tips
  | "completion_25"
  | "completion_75"
  | "completion_100"
  | "seek"
  | "sponsor_shown"
  | "sponsor_clicked"
  | "ad_impression"
  | "ad_completed"
  | "ad_skipped"
  | "tip_sent"
  | "video_opened";

/**
 * The complete, ordered list of canonical event names. Useful for validation, enumeration in
 * admin/studio analytics surfaces, and exhaustiveness checks. Kept in lockstep with AxpEventName.
 */
export const AXP_EVENT_NAMES = [
  "impression",
  "play",
  "view_3s",
  "completion_50",
  "episode_completed",
  "beat_started",
  "beat_completed",
  "branch_shown",
  "branch_selected",
  "countdown_expired",
  "cut_switched",
  "pov_selected",
  "intensity_selected",
  "language_switched",
  "caption_toggled",
  "ad_toggled",
  "sign_toggled",
  "unlock_shown",
  "unlock_purchased",
  "premium_cut_shown",
  "premium_cut_purchased",
  "credits_earned",
  "credits_spent",
  "ad_watched",
  "checkin",
  "follow_bonus",
  "subscription_started",
  "subscription_canceled",
  "paywall_presented",
  "save",
  "unsave",
  "favorite",
  "character_followed",
  "channel_followed",
  "comment_posted",
  "comment_liked",
  "post_liked",
  "share",
  "invite_sent",
  "invite_joined",
  "invite_first_watch",
  "download_started",
  "download_completed",
  "offline_watched",
  "search_performed",
  "series_opened",
  "continue_resumed",
  "chapter_started",
  "chapter_completed",
  "work_finished",
  "chapter_reread",
  "work_shared",
  "work_followed",
  "completion_25",
  "completion_75",
  "completion_100",
  "seek",
  "sponsor_shown",
  "sponsor_clicked",
  "ad_impression",
  "ad_completed",
  "ad_skipped",
  "tip_sent",
  "video_opened",
] as const satisfies readonly AxpEventName[];

/**
 * Compile-time guard that AXP_EVENT_NAMES covers exactly the AxpEventName union. If a member is
 * added to one but not the other, this assignment fails to typecheck.
 */
type _AxpEventNamesAreExhaustive = AxpEventName extends (typeof AXP_EVENT_NAMES)[number]
  ? (typeof AXP_EVENT_NAMES)[number] extends AxpEventName
    ? true
    : never
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _axpEventNamesAreExhaustive: _AxpEventNamesAreExhaustive = true;

/** Runtime membership check against the canonical set. */
export function isAxpEventName(value: string): value is AxpEventName {
  return (AXP_EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * Free-form, JSON-serializable event properties. Carries event-specific payload such as the
 * logged `propensity` for decision/paywall events, `completion` percent, choice latency, etc.
 * Kept open by design so individual events can attach the props the recommender and adaptive
 * engine consume without widening the closed name union.
 */
export type AxpEventProps = Record<string, unknown>;

/**
 * A single analytics event.
 *
 * Idempotency contract: the events stream is idempotent on (sessionId, eventId). A producer that
 * retries a send MUST reuse the same eventId so the consumer dedupes rather than double counts.
 *
 * Keyed by user/series/episode/beat/variant where applicable (all optional except the identity
 * and routing fields). `propensity` is the logged decision propensity for events that are a
 * logged decision (for example paywall_presented, cut_switched), per GOLD_STANDARD_13 section 2.
 */
export interface AxpEvent {
  /** Producer-generated unique id for this event. Idempotency key together with sessionId. */
  eventId: string;
  /** The session this event belongs to. Idempotency key together with eventId. */
  sessionId: string;
  /** Canonical event name from the closed taxonomy. */
  name: AxpEventName;
  /** Authenticated user, when known. */
  userId?: string;
  /** Series the event is scoped to, when applicable. */
  seriesId?: string;
  /** Episode the event is scoped to, when applicable. */
  episodeId?: string;
  /** Beat the event is scoped to, when applicable. */
  beatId?: string;
  /** Variant (cut) the event is scoped to, when applicable. */
  variantId?: string;
  /**
   * The decision this event is an outcome of, echoed verbatim from the /decide response decision_id.
   * This is the join key the Outcome Joiner uses to attach delayed outcomes (continuation, D1/D7 return,
   * unlock, revenue) back to the decision and close the matched triple. Set it on every event that follows
   * a decision for the served beat (impression, beat_completed, branch_selected, unlock_purchased, ...);
   * leave it unset for events that are not the consequence of a decision (for example search_performed).
   */
  decisionId?: string;
  /** Logged decision propensity in [0, 1] for events that are a logged decision. */
  propensity?: number;
  /** Event time as an epoch milliseconds timestamp or ISO 8601 string. */
  ts: number | string;
  /** Event-specific payload. */
  props?: AxpEventProps;
}

/**
 * Fields a caller supplies when emitting. The SDK is responsible for stamping `eventId` and `ts`
 * (and may default `sessionId` from its own context), so they are optional on the input. Callers
 * that need deterministic idempotency may still pass an explicit `eventId`.
 */
export type AxpEventInput = Omit<AxpEvent, "eventId" | "ts" | "sessionId"> & {
  eventId?: string;
  sessionId?: string;
  ts?: number | string;
};

/**
 * The typed emit interface implemented by analytics transports (HTTP, queue, mock).
 *
 * Implementations MUST preserve the (sessionId, eventId) idempotency contract: re-emitting an
 * event with the same key is a no-op at the consumer. `emit` returns the fully materialized event
 * (with eventId/ts/sessionId stamped) so callers can correlate and retry idempotently.
 */
export interface AxpEventEmitter {
  /** Emit a single event. Resolves with the materialized, stamped event. */
  emit(event: AxpEventInput): Promise<AxpEvent>;
  /** Emit a batch of events. Resolves with the materialized, stamped events in order. */
  emitBatch(events: readonly AxpEventInput[]): Promise<AxpEvent[]>;
  /** Flush any buffered events. Optional for transports that send synchronously. */
  flush?(): Promise<void>;
}

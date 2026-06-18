// Auth analytics for the 20-V0 flow. Two distinct things happen here, kept honest about the canonical
// taxonomy (packages/analytics-sdk/src/events.ts):
//
//   1. Profile picks map onto a REAL taxonomy member: each selected channel emits "channel_followed".
//      That is the one auth-flow action with a first-class event name, so we emit it through the typed
//      emitter contract (AxpEventEmitter) when one is wired.
//
//   2. The sign-in lifecycle (prompt shown, provider chosen, magic link sent, verify ok/failed, profile
//      created) has NO member in the CLOSED canonical union, and widening that union is a contract change
//      owned by GOLD_STANDARD_13, NOT this slice. So those steps are recorded as breadcrumbs via an
//      injectable sink (default: console.debug, no-op in production unless wired). They are deliberately
//      NOT smuggled in under an unrelated event name. A followup tracks adding canonical auth events.
//
// No personal/biometric data crosses here (sovereign-plane gate): breadcrumbs carry the step name and a
// coarse method, never the email/token. No em dashes.
//
// We depend only on the SHAPE of the canonical emitter, not the SDK package, so this slice adds no new
// workspace link. The names used ("channel_followed") are members of the canonical union in
// packages/analytics-sdk/src/events.ts; a wired emitter from that SDK satisfies CanonicalEmitter.

// Minimal structural mirror of @axessplayer/analytics-sdk's AxpEventEmitter.emit input. An emitter from
// the real SDK is assignable to this. Kept local so apps/web needs no extra dependency for this slice.
export interface CanonicalEmitter {
  emit(event: { name: string; props?: Record<string, unknown> }): Promise<unknown> | unknown;
}

export type AuthStep =
  | "sign_in_prompt_shown"
  | "sign_in_started"
  | "magic_link_sent"
  | "auth_verified"
  | "auth_failed"
  | "profile_create_shown"
  | "profile_created";

export type AuthMethod = "apple" | "google" | "email_magic_link" | "email_password";

export interface AuthBreadcrumb {
  step: AuthStep;
  method?: AuthMethod;
  // A coarse, non-personal reason code on failure (for example an IdentityError code). Never a token/email.
  reason?: string;
}

export interface AuthAnalytics {
  // Lifecycle breadcrumb (no canonical taxonomy member yet, see file header).
  breadcrumb(crumb: AuthBreadcrumb): void;
  // A real canonical event: the viewer followed a channel via an onboarding pick.
  channelFollowed(channelId: string, props?: Record<string, unknown>): void;
}

export interface AuthAnalyticsOptions {
  // Optional canonical event emitter (HTTP/queue/mock). When absent, channel_followed is a logged no-op
  // so the UI still works pre-backend.
  emitter?: CanonicalEmitter;
  // Optional breadcrumb sink override; defaults to console.debug.
  onBreadcrumb?: (crumb: AuthBreadcrumb) => void;
}

export function createAuthAnalytics(opts: AuthAnalyticsOptions = {}): AuthAnalytics {
  const sink =
    opts.onBreadcrumb ??
    ((c: AuthBreadcrumb) => {
      // Breadcrumb only; safe to leave on, it carries no personal data.
      // eslint-disable-next-line no-console
      if (typeof console !== "undefined") console.debug("[auth]", c.step, c.method ?? "", c.reason ?? "");
    });

  return {
    breadcrumb(crumb) {
      sink(crumb);
    },
    channelFollowed(channelId, props) {
      if (!opts.emitter) return;
      // "channel_followed" is a canonical AxpEventName member.
      void Promise.resolve(opts.emitter.emit({ name: "channel_followed", props: { channel_id: channelId, ...props } }));
    },
  };
}

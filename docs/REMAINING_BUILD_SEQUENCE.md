# Axessplayer: the remaining build sequence (canonical)

June 2026. The ordered, gated instruction set for everything after the upload and encode fix. No em dashes.

Each workstream is gated: not done until its acceptance test passes in a real browser with evidence (IDs,
network, console, screenshots). Storage-layer or unit-level passes are not acceptance. Reproducibility gate:
a result counts only if it passes from a clean reload on the same data. Work in order unless a dependency says
otherwise. B1 can run in parallel immediately.

## Cross-cutting invariants (apply to every workstream)

1. Cached, not live. Everything a free viewer hits is a pre-rendered variant selected by the decision engine.
   Live per-viewer generation is never on the free path. Generation is credit-gated premium only (B8).
2. Consent and provenance as precondition. No personalized or placed variant serves unless the required
   consents are on the ledger; every synthetic or adapted variant is C2PA-signed. The gate is inside the serve
   path, not a wrapper.
3. EU AI Act Article 50 disclosure (enforceable 2 August 2026). Any adapted or synthetic variant carries the
   human- and machine-readable disclosure. The "why this cut" panel is the mechanism; extend it to every new
   variant type (placement, personalization).
4. FTO-safe placement only. In-scene placement is slot-declared-at-authoring and rendered into the frame (or
   shot into a marked surface). No automated detect-and-composite into arbitrary footage.
5. The lift gate. The per-viewer narrative re-cut is unproven. B3 proves or disproves it. Do not build the
   narrative bandit or fund B8's frontier path until B3 shows lift.
6. Frozen boundary. Do not modify contracts, economy ledger RPCs, or supabase migrations without orchestrator
   sign-off. If a UI need requires a contract change, stop and raise it.

## Workstreams

### B0. Upload and encode fix (prerequisite) — IMPLEMENTED, pending in-browser acceptance
A freshly uploaded variant must encode, reach `ready` on its own, and play in the consumer app; invalid files
fail loudly. Nothing below ships until B0 passes in the user's real browser. Status: media server does real
ffmpeg HLS encode with a job lifecycle (proven headless: positive -> ready + valid HLS h264 540x960 + aac;
negative -> failed with reason). Studio polls to terminal state and registers master.m3u8 with qa_status
passed. Awaiting the user's clean-reload browser run.

### B1. Production cluster: audit logging on, patch cadence set (parallel, immediate)
Enable Kubernetes audit logging and a patch policy (or auto-upgrade + maintenance window) on `swissbrain-prod`
(CH-GVA-2), which holds consent and economy (Article 9) data; mirror the GPU cluster which already has both on.
Acceptance: audit logging on, audit trail writing, patch policy documented; console screenshot. Infra only, no
app changes. Depends on nothing. NOTE: this is a prod-console action on the user's Exoscale account and a STOP
gate for the agent; the user executes it. Agent can document exact steps and the patch policy.

### B2. Events collector: close the capture loop end to end
Stand up the collector endpoint; ship the player's beat events to it; land them in the warehouse (hot path for
dashboards, cold path for training). Each event carries decision_id and propensity so outcomes attribute to the
causing decision. No PII in URLs; consent-gated. Acceptance: watch one episode end to end, query the warehouse,
show the rows for that session (beat completions, cut served, decision_id, propensity, at least one reward
signal: continue or return) joined on decision_id. No ML training yet. Depends on B0.

### B3. Cut-selection A/B and the lift dashboard (de-risking, the hinge)
Run a real A/B: treatment (adaptive cut from pre-rendered variants by the policy) vs control (fixed director's
cut), logging propensity. Build the lift dashboard: treatment vs control on completion, 7-day return, and
revenue per finished play, with confidence intervals. Wire off-policy evaluation (IPS, doubly robust) so any
new policy is estimated on logged data before it serves. Acceptance: dashboard shows treatment vs control with
those metrics and CIs from real sessions; an OPE estimate is produced for a candidate policy before it serves.
Depends on B2. Do not scale the bandit or build narrative-state until lift is shown positive.

### B4. Real content ingestion at scale (Path A)
Wire ingestion to real Exoscale object storage (sovereign CH/EU); confirm the B0 encode-to-HLS pipeline at
episode scale; ingest the first real micro-series with language and accessibility variants. Acceptance: one
real episode (multiple beats, EN + at least one other language, captions + audio description) ingested to real
storage and playing in the consumer app with accessibility tracks selectable. Human-spine Tier A content plus
cached variants, not generation. Depends on B0.

### B5. Placement-slot authoring (B2B revenue, FTO-safe)
In the Studio, author a slot on a beat (surface, category) at authoring time; assign a campaign by market,
country, cohort, daypart with frequency caps. At serve time the decision engine fills the slot, brand asset
rendered into the frame (slot-at-authoring only). Brand-safety and canon-safety are hard filters. Every filled
slot writes a ledger entry with campaign and a provenance reference. Acceptance: author a slot, assign two
campaigns by market, show the correct brand filling for two simulated viewers in different markets, each write
logged with campaign and provenance; confirm no detect-and-composite path. Depends on B0 + FTO green light.

### B6. Brand and sponsor marketplace (buy side)
Self-serve surface: rank content by performance, expose open slots, let a brand assign a campaign and budget by
market and cohort, split revenue to creator/production through the same ledger. Sponsorship and branded
interstitials run on the separate ad plane, attributed per series. Acceptance: a brand user assigns a campaign
to an open slot with market and budget; it serves per the B5 engine; the creator's attributed revenue appears
as a ledger query. Depends on B5.

### B7. Wallet completion: Earn, Buy, Subscribe
Rewarded-ad-to-credits; credit-pack purchase; subscription + entitlements (Stripe on web, RevenueCat on
mobile). Deterministic, clearly priced, no randomized paid mechanics. A policy service checks spend windows and
age before any ledger write. Reuse the hardened economy ledger; do not modify its RPCs. Acceptance: a user
earns credits from a rewarded ad, buys a pack, and subscribes; each path writes the correct ledger entries
idempotently; a subscribed user sees ad-free playback with the credit allowance; a replayed purchase shows
idempotency holds. Depends on B0, B3. STOP gate: no live payment credentials in any automated flow.

### B8. Be-the-protagonist, credit-gated (GATED, frontier last)
Consented viewer's face on the protagonist track as a face-swap onto a cached base render, credit-gated. Do not
build until B3 shows positive lift and the consent layer is proven. Identity enrollment with verified-permission
face matching and explicit biometric consent on the ledger (BIPA, GDPR Article 9), time-limited and
hard-deletable. Render via a bought face-swap API into a per-user cache on sovereign infra. C2PA-sign every
frame, disclose under Article 50. Never full per-viewer generation. Acceptance: a consented test user enrolls,
their copy of one beat stars their face, served only after the consent check passes, every frame C2PA-signed
and disclosed, and revoking consent deletes the biometric data and the cached render. Depends on B3, B7, the
consent layer.

## The gate logic

B3 is the hinge. Positive lift -> B5 to B8 are worth scaling and the frontier path (self-host generation, the
Narrative World Model) becomes the Series A story. Near-zero lift -> the consumer app still stands on B4's
accessibility and localization, and the most expensive part of the roadmap is saved. Order ships a solvent
product: capture, prove, monetize, then personalize.

## Standing rule

The screenshot is ground truth; the summary is intent. Nothing is done until its acceptance test passes in the
user's real path, to completion, with evidence. Reproduce, do not assert.

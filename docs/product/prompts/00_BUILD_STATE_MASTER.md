# Master build state: full Axessplayer platform (continuous build, prompt 00)

Canonical, committed progress for the full end-to-end build (founder directive: full functionality
before viewers, no Gate-A stop). An agent recovers state from THIS file, never from memory (C16). Source
of truth: GOLD_STANDARD_01/02/03 + GOLD_STANDARD_CORRECTIONS.md (corrections win). No contracts/ or
supabase/migrations/ edits. Hosted mobile schema (extend via the infra/hosted deploy transform, never the
frozen migrations). Instrument every surface. No em dashes.

Operating model: one agent, role hats in sequence per ticket: Product/decompose -> Implementer ->
independent Reviewer + Test Authority (spec-derived tests, non-author review) -> merge on green ->
commit + push. Progress note after each plane.

Three founder sign-offs (build fully, then PAUSE for go-live; keep building other planes meanwhile):
- [x] money/ledger semantics go-live  <- SIGNED OFF 2026-06-17. Coin ledger is LIVE: the grant settlement
      server (services/monetization serve.ts) settles verified rewards + paid TEST-mode Stripe to economy
      /grant (demo coins, idempotent). STILL OFF by standing safety rule: the live Stripe key and any
      real-money charge (livemode sessions are refused); flip to live out of band when ready.
- [x] biometric/consent architecture go-live  <- SIGNED OFF 2026-06-17. Architecture approved and live
      (services/trust serve: consent hash-chain write + C2PA verify tap-through + EU/Swiss routing). STILL
      PENDING infra: the TEST C2PA signer -> real KMS-backed cose-sign1 cutover needs KMS credentials (not
      available to the agent). Be-the-protagonist likeness remains fenced (C9), separate from this sign-off.
- [ ] reward-function weights ratification

## Plane status (build order)

- P1 Data + contracts. DONE. mobile schema deployed + verified; hero fixture seeded.
- P2 Adaptive content engine. LARGELY DONE. content/decision/manifest services; LinUCB + softmax
  propensity; OPE IPS+DR; Gate A epsilon-greedy harness + surrogate + readout (prompt 01). GAP: canon
  constraint solver audit [P2-T1]; confirm /decide logs propensity on every path [P2-T2].
- P3 Viewer player + feed. LARGELY DONE. vertical 9:16 player, prefetch + seamless switch, feed,
  instrumented test player. capture.ts emits consent-gated events but needs a collector. GAP: events
  collector persisting engagement events to the hosted schema + feed-surface emission [P3-T1].
- P4 Accessibility. LARGELY DONE. CWI three-axis, AD + EAD pause, EN/ES dub, sign PiP, graceful-absence,
  availability regression guard. GAP: compliant-default-plus-color audit (C10) [P4-T1]; self-attaching
  track URLs on upload [P4-T2]; remembered toggles + single-language drive [P4-T3].
- P5 Recommender (isolated from re-cutter, C5). DONE (library). services/recommender: featureStore.ts
  (engagement-only features + the C5 firewall assertNoRecutterSignal + duration-debiased watch fraction),
  twoTower.ts (T1 retrieval, identity cold-start towers + retrieveTopK), ranker.ts (T2 multi-task heads
  completion/watch/returns, return-dominant, never raw-watch-maximizing + epsilon exploration with an
  honest top propensity). 12 spec tests. Serving endpoint + offline tower/head training are the remaining
  productionization (flagged; the math + interfaces are done). Head/task weights are flagged placeholders
  for the reward-weights founder sign-off.
- P6 Monetization + ledger. PARTIAL. economy spend/grant RPCs exist (hosted, F-hardened); web/Studio
  purchasing only (IAP tax C8). GAP: unlock sheet -> /spend [P6-T1]; pass/sub/rewarded-ad [P6-T2];
  bandit paywall [P6-T3]; Stripe test-mode checkout [P6-T4]. SIGN-OFF: money/ledger go-live.
  STATUS: P6-T1 unlock->/spend DONE (useUnlock, idempotent, server-derived paywall on 402). P6-T2/T3/T4
  logic DONE as services/monetization (paywall bandit, idempotent reward settlement, Stripe-to-grant), all
  pure + fenced behind the money sign-off. economy /grant stays service-to-service (clients cannot mint).
- P7 Consent + provenance + trust. PARTIAL. consent gate + consent_ledger table + Article 50 disclosure.
  GAP: consent ledger write path [P7-T1]; C2PA signing at serve + provenance tap-through (disclosure not
  explanation C7) [P7-T2]; trust serve listener [P7-T3]; EU/Swiss routing flag [P7-T4]. SIGN-OFF: consent.
  STATUS: DONE to the gate. services/trust domain (C2PA TEST signer, hash-chain consent ledger, verify)
  already built; added server.ts (POST /provenance, POST /consent write path, GET /verify/<id> Article 50
  tap-through = disclosure not explanation), serve.ts (hosted pool), sovereignty.ts (EU/Swiss fail-
  sovereign routing). 24 trust tests green. Real KMS C2PA + biometric-consent go-live fenced for sign-off.
- P8 Creator Studio. LARGELY DONE. library, branch editor, media/variant, poster, pricing, publish. GAP:
  accessibility editor [P8-T1]; channel + monetization settings + wallet [P8-T2]; analytics with
  off-policy counterfactuals as BANDS not points (C6) [P8-T3].
- P9 Admin/operator console. CORE DONE (library). services/admin: alerts.ts (adaptive-policy alerts from
  the Gate A readout: guardrail-breach critical, underperforming-cut warn, inconclusive-at-scale info),
  moderation.ts (first-decision-wins queue state machine, human-in-the-loop, idempotent), payouts.ts
  (creator earnings REPORT with flagged platform fee, never a disbursement). 7 spec tests. Per-video
  insight + trust center reuse presentation.ts (beat retention, C6 bands) and trust verify. Remaining: the
  dashboard UI app surfaces (consume these + the readout/OPE/trust APIs).
- P10 Generation pipeline. CORE DONE. services/generation already had spec/pipeline/backends (cost-gated)/
  qa/cdn/c2pa. Added finops.ts (C16 FinOps gate: budget with default DENY_ALL, authorizeSpend refuses zero
  and over-budget; nothing generates until a budget is approved) and variantSource.ts (the unified
  interface: prerendered asset passes through; a generation spec runs only when the tier is permitted AND
  the FinOps budget authorizes; B_likeness be-the-protagonist is FENCED per C9; real-time world-model
  generation fenced, interface ready). 42 generation tests. Real model calls remain behind the FinOps
  budget (cost sign-off) and the backends cost gate.
- P11 Brand + placement + marketplace. CORE DONE. services/placement: safety.ts (brand-safety constraint
  gate, fails closed: rating/exclusion/competitor), placement.ts (in-scene placement = render-time slot on
  a beat_variant on the CONTENT plane, never an ad interstitial; the content/ad plane firewall
  assertNotAdPlaneDriven throws if an ad-CTR signal would drive cut selection; selectPlacement picks a
  safety-passed bid with an honest propensity, never an unsafe one, null when none safe), marketplace.ts
  (self-serve campaign matcher: targeting + budget + safety). 8 spec tests; full turbo 25/25.
- P12 White-label licensing + engine-API metering. GAP. last, real demand only.

## Fenced off (do NOT build into core; C9)
- Be-the-protagonist likeness insertion: isolated, behind consent ledger; architect variant interface for
  it, do not build now.
- Real-time world-model render-time generation: architect interface; build when latency/cost threshold met.

## Status log
- 2026-06-17: master build-state created. Prompt 01 COMPLETE, CI green (aa07af6). P1 done; P2/P3/P4/P8
  largely done. Starting the gap-closing sweep in build order. Three sign-offs pending.
- 2026-06-17: P2 verified by audit. P2-T1: canon constraint solver present (services/decision/src/canon.ts
  canonFilter gates the arm set so re-cuts cannot contradict beats.canon_facts). P2-T2: all three /decide
  paths (adaptive, control/opt-out, timeout/error) log via deps.logger.log before returning; propensity is
  set on every path (null for the deterministic director's cut, which IPS excludes). No code change needed.
- 2026-06-17: P3-T1 DONE. Built services/events (the engagement events collector): collector.ts (validate
  the frozen events.md types, reject a body user_id per F1, idempotent map to columns + payload),
  server.ts (POST /events, stamps user_id from the session bearer), serve.ts (pg pool, hosted mobile
  schema). Added mobile.engagement_events (append-only, idempotent on session_id+event_id) to the hosted
  schema and the infra/hosted deploy transform. 12 spec-derived node:test cases pass; typecheck clean.
  Live-verified against hosted: a 3-event batch -> 2 accepted with user_id stamped from the session (not
  the body), 1 F1 violation rejected; smoke rows cleaned. Wiring: set VITE_EVENTS_BASE_URL to the collector
  so apps/web capture.ts ships consent-gated events. P3 now fully instrumented.
- 2026-06-17: P4-T1 DONE (9cdb0dc). C10 caption compliance: always-on speaker NAME tag (redundant
  non-color cue) + character color as a controllable enhancement (captionColor pref + A11ySheet toggle;
  off = compliant white). 4 spec tests; web suite 61 green. P4-T3 verified by audit: a11y prefs persist
  to localStorage (axessplayer.a11y) and one language pref drives audio + captions + sign together in
  Player.tsx (single-language drive). REMAINING P4-T2: self-attaching track URLs on Studio upload. Next:
  P4-T2 then P5 recommender (two-tower + ranker, separable from the re-cutter, C5).
- 2026-06-17: P4-T2 mechanism DONE. deriveTrackUrls + listTracks in apps/studio/src/api/media.ts (master
  URL + present files -> 0009a track URL fields; only the ASL sign base, PSL/LSA derived client-side) with
  4 spec tests (studio suite 34 green). Media-server GET /tracks/<id> lists the accessibility files in the
  media dir; live-verified (returns captions/ad/sign/5 dubs). CONTRACT GATE flagged: attaching these onto
  the variant needs 0009a track-URL fields ratified into the frozen content POST /variants contract (must
  not edit contracts/). Until ratified, URLs derive + apply out of band. P4 complete to the contract
  boundary. Next: P5 recommender.
- 2026-06-17: P5 DONE (library). services/recommender built: two-tower retrieval (T1), feature store with
  the C5 firewall + duration-debiased watch fraction (T3 + T4), multi-task ranker with exploration (T2).
  12 spec tests; full turbo typecheck 22/22 + test 22/22 green. The recommender trains on engagement only;
  assertNoRecutterSignal throws if a cut-selection signal is used as a feature (C5 attribution firewall).
  Head/task weights flagged for the reward-weights founder sign-off. Next: P6 monetization + ledger (build
  to the money sign-off gate), then P7 consent + trust.
- 2026-06-17: P6 DONE to the gate. P6-T1 (unlock->/spend) already wired. Built services/monetization:
  paywall.ts (bandit offer selection, honest propensity, fixed founder-approved offers, no dark patterns),
  rewards.ts (idempotent rewarded-ad/daily-checkin settlement, server-minted only), stripe.ts (paid+test
  checkout -> idempotent grant; livemode blocked until sign-off). grant.ts shared shape. 9 spec tests;
  full turbo typecheck 23/23 + test 23/23 green. >>> FOUNDER SIGN-OFF NOW WAITING: money/ledger go-live
  (the /grant call + live Stripe). Continuing to P7 consent + provenance + trust without blocking.
- 2026-06-17: P7 DONE to the gate. services/trust serve listener built (server.ts: provenance, consent
  write path, verify tap-through; serve.ts hosted pool; sovereignty.ts EU/Swiss routing). The C2PA signer
  is the TEST HMAC (real KMS cose-sign1 is the cutover); consent ledger is the tamper-evident hash chain.
  24 trust tests; full turbo 23/23. >>> FOUNDER SIGN-OFF NOW WAITING (2 of 3): biometric/consent
  architecture go-live. Continuing to P8 Studio gaps (accessibility editor, channel/monetization/wallet,
  analytics as bands not points) then P9 admin, P10 generation, P11 marketplace, P12 licensing.
- 2026-06-17: P8-T3 DONE (C6 analytics). services/experiment/presentation.ts: counterfactualDisplay
  (off-policy estimate -> relative uplift BAND or inconclusive, never a point), winRateLabel (coarse),
  beatRetentionCurve (observed reached/completed per beat from engagement events). apps/studio
  AnalyticsPanel.tsx renders observed retention as measured rates + the counterfactual as a band only.
  4 experiment + 4 studio spec tests; full turbo 23/23. REMAINING P8: T1 accessibility editor surface and
  T2 channel + monetization settings + wallet (Studio UI over existing APIs; the deriveTrackUrls mechanism
  from P4-T2 and the economy/monetization APIs back them).
- 2026-06-17: FOUNDER SIGNED OFF money/ledger + consent architecture. Wired the money go-live boundary:
  services/monetization/server.ts (createSettlementServer: POST /reward/ad, /reward/checkin,
  /stripe/webhook -> GrantSink) + serve.ts (real sink POSTs economy /grant with ECONOMY_SERVICE_SECRET).
  Coin ledger LIVE (demo coins). Live Stripe key + real charges remain OFF per safety rule (livemode
  refused). Consent live; real KMS C2PA signer awaits creds. 14 monetization tests; full turbo 23/23.
  Remaining sign-off: reward-weights ratification (decision/recommender/paywall placeholder weights).
  Next: P8 Studio gaps.

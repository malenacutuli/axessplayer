# Prompt 01 build state: instrumented test player + measurement harness

Canonical, committed build state for prompt 01 (Phase 0 moat-validation slice). An agent recovers
progress from THIS file, never from memory (CORRECTIONS C16 durability gate). Built per CORRECTIONS
C1/C3/C4/C5. No accessibility stack, no wallet, no recommender, no branching UI. Data home is the
hosted `mobile` schema (project faeyekynudyzeotbjfsj). Do not edit contracts/ or supabase/migrations/.
No em dashes.

## Tickets (dependency-ordered; each has an acceptance gate)

- [x] T1 Content fixture. DONE 2026-06-16, verified. One hero series ("The Other Key (Hero Test)"),
  one episode, 6 beats (hook, cliffhanger x2, branch_point, pre_paywall, ending), each with 2 real
  pace variants (slow = designated Control tier=showrunner, fast = candidate), real playback_url at
  the media-server /media/hero/*, qa_status=passed. Media: tools/fixtures/build-hero-fixture.sh
  (ffmpeg pace cuts from existing footage). Seed: tools/fixtures/seed-mobile-hero.sql (applied to the
  hosted mobile schema). VERIFIED: series_published=1, beats=6, variants=12, edges=5 (linear spine),
  beats_with_exactly_one_control=6, passed_variants=12.

- [ ] T2 Arm assignment. Stable 50/50 Control vs Treatment per viewer (hash of viewer_id), logged.
  Control = the designated fixed variant every beat. Treatment = epsilon-greedy per beat over that
  beat's variants. Feed/order held FIXED and identical across arms (C5: isolate the cut).
  Accept: same viewer always same arm; ~50/50 split over many viewers; Control path is the designated
  variants only.

- [ ] T3 Epsilon-greedy selection + honest propensity. Context-free epsilon-greedy picking the best
  variant by surrogate reward, exploring with epsilon. Propensity logged = 1-eps+eps/k for the greedy
  arm pick, eps/k for an explored non-greedy pick, 1.0 for Control. (Distinct from the existing LinUCB
  softmax path; this is the Gate A policy.)
  Accept: logged propensity matches the formula for control and both greedy/explore cases.

- [ ] T4 Propensity logging on every impression. viewer_id, session_id, beat_id, served_variant_id,
  arm (is_control), propensity, policy_version, timestamp -> mobile.decision_log. session_id carried.
  Accept: a sample query proves zero unlogged impressions across a full play-through.

- [ ] T5 Surrogate reward + components (C4). Session-end surrogate = weighted blend of beat completion,
  session continuation (advanced to next beat), next-session-within-24h. Log RAW components (not just
  the blend) into decision_log.reward jsonb so weights re-tune offline. D1/D7 + completion computed
  offline as the guardrail the surrogate is validated against.
  Accept: reward components present per decision; surrogate vs D7 correlation computable.

- [ ] T6 Minimal instrumented player. Strip the existing vertical player to: video surface, prefetch
  of candidate next-beat variants, seamless switch at a cut (no seam), nothing else. On entering each
  beat it asks /decide which variant, prefetches it and the likely next, switches with no seam.
  Accept (real browser): hero series plays end to end in BOTH arms, seamless switch, no visible seam.

- [ ] T7 Measurement harness (readout). Per-arm D1/D7 retention, completion, mean surrogate, guardrails
  (paywall conversion proxy, skip-rage), with a sequential-significance verdict (always-valid CI or
  SPRT). Plus an off-policy estimate (clipped IPS + DR via services/experiment/ope.ts) for a candidate
  policy on logged data. Off-policy shown as a band, never a point number (C6).
  Accept: readout renders all metrics per arm with a sequential verdict; uses real logged data; a
  session simulator seeds enough sessions to demonstrate the readout end to end (live D7 verdict awaits
  real viewers accruing over time).

- [ ] T8 Gate A verification. Reproduce in the real browser; show the readout output and a sample
  propensity query proving zero unlogged impressions. Decision rule (pre-registered): Treatment lifts
  D7 by >= 2-3 pts absolute with no paywall degradation => Gate A green, proceed to prompt 03. If flat,
  report honestly; moat pivots to dynamic brand/market adaptation. Do NOT claim per-viewer
  personalization from this test (that is Gate B, prompt 03).

## Notes / decisions
- Epsilon-greedy (context-free) is the Gate A policy, deliberately simpler than the existing LinUCB
  (bandit.ts). LinUCB/contextual is for Gate B later.
- Real D7 needs real viewers over 7 days; this build delivers the HARNESS and demonstrates it with a
  session simulator. The live Gate A verdict is read once real data accrues.
- playback_url points at the local media-server for the local Gate A run; CDN at deploy time.

## Status log
- 2026-06-16: build-state created. CI green (06de8fa). Hosted mobile schema wired + verified
  (services connect with search_path=mobile,public). Starting T1.
- 2026-06-16: T1 DONE + verified in the hosted mobile schema (fixture + 12 pace variants seeded,
  Control designated per beat).
- 2026-06-16: T2/T3/T4/T5/T7 DONE as services/experiment/src/gatea/ (arm.ts, policy.ts, surrogate.ts,
  log.ts, readout.ts, simulate.ts, run-readout.ts) with 27 passing node:test cases. Readout demo: LIFT
  scenario gives Treatment D7 37.5% vs Control 29.7%, diff +7.8%, always-valid 95% CI [3.9%,11.7%],
  guardrails ok -> GATE A GREEN; FLAT gives INCONCLUSIVE (correctly refuses a false green). Off-policy
  SNIPS shown as a band (C6). All pure logic + node:test so CI stays green; no hosted/browser needed.
  REMAINING: T6 minimal instrumented player, then T8 Gate A real-browser run.
- 2026-06-16: T6 + T8 DONE. services/experiment/src/gatea/player-server.ts is a self-contained
  instrumented test player (isolated from the production services/contracts): reads the hero spine from
  the hosted mobile schema, assigns Control vs Treatment, selects per beat (Control = showrunner;
  Treatment = epsilon-greedy), LOGS every impression with its propensity to mobile.decision_log, and
  serves a two-video seamless-switch player. Verified in a real browser (Playwright, both arms):
  6 beats each, seamGaps=0, real 1920px frames (no black, no seam), no console errors. Control played
  the showrunner variants a1-a6 at propensity 1.0; Treatment played the candidate variants f1-f6 at
  propensity 0.9 (= 1-eps+eps/k, eps=0.2, k=2). Acceptance query on mobile.decision_log:
  total_impressions=12, unlogged_propensity=0 (ZERO unlogged), 6 control + 6 treatment, 12 distinct
  variants, avg control propensity 1.000, avg treatment 0.900.
  HONEST CAVEAT (C1/C15): the measurement harness is complete and demonstrated GREEN on a planted lift
  and INCONCLUSIVE on flat (run-readout.ts), but the LIVE Gate A D7 verdict requires real viewers
  accruing over days. Do not claim Gate A green on real data yet, and do not claim per-viewer
  personalization (that is Gate B / prompt 03).
- PROMPT 01 COMPLETE (buildable scope): T1-T8 done. Next per the program: prompt 03 (off-policy + the
  heterogeneity test for Gate B) once real Gate A data accrues, OR the parallel accessibility track
  (prompt 07) which is already largely built.

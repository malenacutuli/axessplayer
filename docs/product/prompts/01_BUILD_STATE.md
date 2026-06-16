# Prompt 01 build state: instrumented test player + measurement harness

Canonical, committed build state for prompt 01 (Phase 0 moat-validation slice). An agent recovers
progress from THIS file, never from memory (CORRECTIONS C16 durability gate). Built per CORRECTIONS
C1/C3/C4/C5. No accessibility stack, no wallet, no recommender, no branching UI. Data home is the
hosted `mobile` schema (project faeyekynudyzeotbjfsj). Do not edit contracts/ or supabase/migrations/.
No em dashes.

## Tickets (dependency-ordered; each has an acceptance gate)

- [ ] T1 Content fixture. One hero series, one episode, ~6 high-leverage beats (hook, two mid
  cliffhangers, one branch point, one pre-paywall, one ending), each with 2-3 real pre-rendered
  variants differing on ONE axis (pace fast/slow). Real playback_url, qa_status=passed. One designated
  Control variant per beat. Seeded into mobile.{series,episodes,beats,beat_variants,beat_edges}.
  Accept: mobile has 1 series, 6 beats, >=12 variants, edges form a single playable spine; a query
  shows exactly one is_control-equivalent designated variant per beat.

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

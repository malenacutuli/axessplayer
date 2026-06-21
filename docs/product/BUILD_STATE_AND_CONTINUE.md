# Build state and continuation kit

**Grounded snapshot + the keystone work to continue the full build. June 21 2026. No em dashes.**

This is the single source of truth for "where we are and what to build next." It is grounded in the live repo
(commit 07e3621) and the live hosted mobile schema (project faeyekynudyzeotbjfsj), queried directly, not assumed.

---

## 1. Where we are (grounded)

**Code surface is broad and real.** 24 services exist (decision, experiment, recommender, events, generation,
ingestion, adaptation, accessibility/trust, economy, catalog, content, brand, placement, identity,
identity-performance, recap, delight, social, library, licensing, manifest, admin, admin-api, monetization, companions).
5 apps exist (web, mobile, studio, admin, marketing). 17 GOLD_STANDARD docs and 29 build prompts are committed.

**The generation engine has moved fast and well.** Recent commits wired a model-agnostic router with consistency QA
and auto-retry, real Runway text-to-video with durable re-host, async start-and-poll for long runs, a continuous
EPISODE pipeline (premise to scenes to N shots to stitched video), Seedance 2.0 as preferred provider with FLF
chaining and fallback, LTX behind the router, and now (commit 07e3621) a cross-provider prompt grammar
(promptcraft.ts) plus an 8-style sourced prompt gallery (promptGallery.ts) with a /gallery and /script surface. This
work is good and is kept. The pricing and model ids remain FLAGGED placeholders until re-verified before real spend.

**The data moat is schema-complete and operationally hollow.** Live mobile schema, queried June 21:

| Table | Rows | Read |
| --- | --- | --- |
| decision_log | 70 | engine is being exercised, but synthetically |
| decision_log with propensity | 32 of 70 | BUG: 38 decisions are un-evaluable off-policy |
| decision_log is_control | 48 | control slice exists |
| decision_log with reward joined | 24 | the matched triple is partially formed |
| engagement_events | 61 | events flow, synthetic |
| viewer_state | 0 | BUG: the Viewer Genome feature builder is not running |
| beats / beat_variants | 14 / 26 | small test catalog |
| series | 5 | seeded |
| users | 2 | no real audience |

**The honest reading.** The platform can generate video and the decision schema is correct, but the engine that
makes Axessplayer a data company (per-viewer genome to variant to measured incremental lift) has never run against
real viewers and currently cannot produce a clean lift number, because propensity is logged on under half of
decisions and the viewer genome table is empty. The build raced on video generation while the decision and data
moat sat unexercised.

---

## 2. The keystone (this gates the raise, build it before more surface)

Three independent inputs now converge on one action: the investor repositioning (the "Outcome Memory" data-company
deck), the IDILIO founder interview (data-first, test demand pre-production), and the REELM adaptation-engine spec
(propensity + control + matched triple = provable lift). All three say the same thing: **the company needs one real,
statistically valid Adaptive Lift number from a randomized control.** We have the engine, the control slice, and the
schema. We do not have the number. Everything below exists to produce it.

### K1. Fix propensity on EVERY decision (correctness bug)
The decision service must log `propensity` (the probability the policy had of choosing the served arm) on 100 percent
of decisions, not 46 percent. Without it, IPS and Doubly-Robust off-policy evaluation are impossible for those rows.
Backfill is not possible (propensity is only knowable at serve time), so fix forward and add a not-null check or a
test that fails if any new decision lands with null propensity. This is the single cheapest high-leverage fix.

### K2. Turn on the Viewer Genome feature builder (empty table)
`viewer_state` has zero rows. Build or switch on the job that derives the per-viewer genome from engagement_events:
EWMA features per narrative attribute (romance_affinity, conflict_tolerance, pacing_preference, caption_reliance,
completion_propensity, unlock_propensity, ad_tolerance, brand_receptivity, churn_risk), an archetype cluster for cold
start, and the consent flags. Write to viewer_state.preference_vector (hot read for serving). Until this populates,
"personalization" has almost nothing to personalize on, and the recap service's by-design no_viewer_state 404 (test
11) is a symptom, not a pass.

### K3. Close the Outcome Joiner for delayed outcomes
The matched triple is only 24 of 70 joined. Run the joiner that attaches delayed outcomes (D1 and D7 return,
downstream unlock and revenue) back to each decision_id, so retention lift is measurable, not just immediate
completion. Single-objective first: continuation or D7 return.

### K4. Run Gate A and report the number
Point a small slice of real traffic (the animated test series THE GROUP CHAT or DATE THE AI is fine) at the engine
with the randomized control held out. The experiment harness reports Adaptive Lift = (adapted minus control) over
control on D7 return or continuation, with a confidence interval. Definition of done: one real lift figure, even if
small and noisy, on one series and one lever. That number replaces every simulated table in the deck.

---

## 3. REELM spec: conformance checklist, NOT a rebuild

The REELM adaptation-engine spec is correct and is the right moat. About 80 percent of it already exists in prompts
01 to 04 and the mobile schema. Treat it as a checklist, not a new build.

| REELM requirement | Status here | Action |
| --- | --- | --- |
| Propensity on every decision | PARTIAL (32/70) | K1 |
| Randomized control slice (is_control) | PRESENT (48) | keep, verify slice size is fixed and logged |
| Matched triple / Outcome Memory | PARTIAL (24 joined) | K3 |
| Viewer Genome feature store (§3b) | MISSING (0 rows) | K2 |
| Scene Genome tags on beats/variants (§4) | PARTIAL (beat_variants metadata) | tag the hero series, human-validate |
| Contextual bandit per lever (Phase 1) | EXISTS (decision engine) | confirm Thompson/LinUCB logs propensity |
| IPS / DR off-policy eval (Phase 2) | NEEDS K1 first | enable nightly once propensity is clean |
| Uplift / CATE / Qini (Phase 3) | NOT NEEDED FOR GATE A | defer, it is reporting polish |
| Multi-objective reward (Phase 4) | DEFER | single-objective first |

### Hard rule: do NOT adopt REELM section 7's infrastructure
Section 7 lists Kafka/Kinesis, Neo4j, Snowflake/BigQuery/ClickHouse, Redis, Vowpal Wabbit. At 70 decisions and 2
users, adopting any of that is delay and value-destruction. Stay on Supabase Postgres (plus an in-process bandit and,
if ever needed, a lightweight queue). The spec itself offers the escape hatch: "or Supabase plus a queue at small
scale." Take it. Revisit heavy infra only when real volume forces it, not before. This reaffirms the standing
no-re-platform discipline (no Neo4j, Kafka, ClickHouse, NestJS).

---

## 4. Continue the surface build (after the keystone is unblocked, in this order)

The keystone (K1 to K4) does not block these forever, it just goes first because it de-risks the company. The
sequenced surface build from BUILD_PROMPT_INDEX still holds:

1. FOUNDATION: prompt 24 (design system, FOUNDATIONAL) + prompt 20 V0 (auth). The four apps drift without 24.
2. DEMAND SENSOR, reprioritized up: prompt 14 (IP-discovery pilot harness). This is IDILIO's actual mechanism
   (cheap pilot to social, real demand signal, produce only winners). It is the cheapest real-data generator and it
   matches their strongest investor claim on a substrate they cannot match (consented, accessible, per-viewer). Move
   it ahead of the heavier surface work.
3. DELIGHT + DISCOVERY: prompt 25 D1 (recap, gated on K2 since recap needs viewer_state), prompt 20 onboarding /
   discover / library, dynamic posters.
4. REVENUE: prompt 19 (brand rail), prompt 23 (footage adaptation).
5. SCALE, AUDIENCE-GATED: prompts 14/15 flywheel completion, 21/22 full admin/studio, 16 companions, 12 licensing,
   20 V8 social (only after moderation).

The prompting work (promptcraft + promptGallery) is complete and folds into the Cinematographer; no further action
beyond keeping model ids and pricing FLAGGED until re-verified.

---

## 5. Standing risks to resolve before real spend or real content

- **Cost-gate bypass (unresolved).** Confirm every real generation routes through the cost-gated generation service
  and lands in generation_attempts with real cost counted against the cap, not through the runway edge function that
  bypasses the cap. Resolve by construction: route all real clips through the gate and verify the attempts appear.
- **R2 masters bucket should be private + signed URLs** before any real or licensed content. Rotate any exposed token.
- **Reward weights** remain a founder-signed gate; do not let an agent self-sign changes.

---

## 6. Definition of done for "continue full build"

The next milestone is not a new feature. It is: propensity on 100 percent of decisions, viewer_state populated by the
genome builder, the outcome joiner closing the triple, and the experiment harness reporting one real Adaptive Lift
number on the test series with a confidence interval, all on the existing Supabase stack with no re-platform. When
that number exists, the deck stops being a vision and becomes a hypothesis-backed seed case, and the surface build
resumes on the sequence in section 4.

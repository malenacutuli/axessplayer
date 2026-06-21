# Build prompt index (handover)

**The complete, ordered build queue. June 2026. No em dashes.**

Every feature has a detailed prompt. Source of truth: the GOLD_STANDARD docs (what), the prompts (how), the design
handoff (look + routing). Build from the prompts AS CORRECTED by GOLD_STANDARD_CORRECTIONS.

## Canonical references (read alongside the prompts)

- docs/product/GOLD_STANDARD_01..15 (the specs), GOLD_STANDARD_CORRECTIONS (binding overrides).
- docs/product/design/DESIGN_HANDOFF_README.md (exact tokens + recap reference impl), INTERACTION_MAP.md (every
  action: destination, landing UI, data source, wiring; the routing source of truth), html_references/*.dc.html
  (high-fidelity visual reference, recreate pixel-accurately).

## The prompts

| # | Prompt | Builds | Status note |
| --- | --- | --- | --- |
| 00 | continuous build directive | the operating model | running |
| 01 | instrumented test player | adaptive player + propensity + Gate A harness | LIVE |
| 02 | beat-graph data model | story graph + variant axes + canon constraint solver | LIVE |
| 03 | off-policy + heterogeneity | surrogate reward, OPE, reward-weights (founder signed) | LIVE |
| 04 | recommender | two-tower + multi-task ranker + feature store | LIVE |
| 05 | monetization + ledger | double-entry ledger, paywall, packs, subs | LIVE backend |
| 06 | creator studio (spec) | superseded by 22 | see 22 |
| 07 | accessibility first-class | CWI, AD, sign PiP, dub toggles | LIVE |
| 08 | trust/consent/provenance | consent ledger, C2PA, Article 50, sovereignty | SERVABLE |
| 09 | generation pipeline | showrunner, model router, identity, localization | backend |
| 10 | brand + placement | placement engine + plane firewall | backend |
| 11 | admin console (spec) | see 21 | see 21 |
| 12 | licensing console | white-label tenants, engine-API metering | backend |
| 13 | ingestion content factory | auto-produce DAG (the upload-once factory) | executor in flight |
| 14 | IP-discovery pilot harness | demand sensor flywheel | planned |
| 15 | growth/UA + creative engine | UA bandit, CAC/LTV, shared substrate | planned |
| 16 | AI companions | open-ended character chat (age/wellbeing gated) | planned, late |
| 17 | identity + performance | face-lock, lip-sync, de-aging (wedge-critical) | planned |
| 18 | footage repurposing (brief) | superseded by 23 | see 23 |
| 19 | brand revenue rail | generation-time placement + demand rails + dual flywheel | planned |
| 20 | viewer parity build | auth, onboarding, channels, discover, library, social, referral, web (V0-V9) | planned |
| 21 | admin console build | 17 operator sections | planned |
| 22 | creator studio build | 14 studio sections, upload-once magic | planned |
| 23 | live-action adaptation | footage adaptation, edit-first + gated generative | planned |
| 24 | design system | tokens + one component library, three skins (FOUNDATIONAL) | planned |
| 25 | delight layer | recap, dynamic posters, character inbox, branch-as-quest | planned |
| 26 | video engine + consistency QA | model-agnostic router + face/scene QA reject-retry + chaining + animated-first (upgrades 09/17/23, GOLD_STANDARD_16) | LIVE (prompt grammar + gallery shipped, model ids FLAGGED) |
| 27 | keystone: data moat + Gate A | propensity-on-every-decision, viewer_state genome builder, outcome joiner, Adaptive Lift number, no re-platform (see BUILD_STATE_AND_CONTINUE) | RUN NEXT, gates the raise |

## Gaps found in the handover audit, now closed

- No shared design-system prompt existed (the handoff demands pixel-accurate, exact tokens). Closed: prompt 24,
  and it is FOUNDATIONAL, build before the surface UIs (20/21/22) or they drift.
- The delight features (recap, dynamic posters, character inbox, branch-as-quest) had specs but no build prompt.
  Closed: prompt 25.
- The design tokens and the route/wiring map lived only in the upload. Closed: committed under docs/product/design/.

## Minor structural notes for the agent (not blockers)

- App split: the handoff assumes apps/mobile, apps/web, apps/studio, apps/admin as four apps sharing the design
  system (prompt 24). Build admin as its own app (apps/admin), not folded into studio.
- Service map (from INTERACTION_MAP): decision, ingestion, adaptation, accessibility, economy, catalog, storygraph,
  brand, analytics, identity (auth+consent), social, recap, experiment. Most exist; storygraph may stay inside the
  content service; experiment is the home for A/B + creative bandit + poster CTR + ending tests (currently spread
  across 03/04/15, consolidate as services/experiment).
- Content formats: episodes support Series / Podcast / Film formats (channels include Podcasts, Education,
  Children); add a format field on the content model.
- The "how to develop viral episodes" creator playbook (contextual by channel) is a small CMS-docs feature in the
  Studio Create flow; spec it as a content page, not a system.
- The "no dead end" rule (INTERACTION_MAP): every control opens its landing route with an explicit empty/coming-soon
  state and emits its analytics event, even before its backend exists.

## Build order (the discipline that governs the whole queue)

1. FOUNDATION: prompt 24 (design system) + prompt 20 V0 (auth). Nothing visual is consistent or real-user-capable
   without these.
2. FINISH THE WEDGE: complete prompt 13 (auto-produce executor + dashboard), prompt 07 polish, prompt 17 (identity-
   lock), and ONE differentiated vertical of real content.
3. DELIGHT + DISCOVERY: prompt 25 D1 (recap, the standout), prompt 20 onboarding/discover/library, dynamic posters.
4. REVENUE: prompt 19 (brand rail), prompt 23 (footage adaptation, the studio-acquisition hook).
5. SCALE/AUDIENCE-GATED: prompts 14/15 (flywheel), 21/22 (full admin/studio), 16 (companions), 12 (licensing), 20
   V8 social (only after 21 moderation exists).

Wedge first, audience-gated features later. The binding constraint remains content and audience, not more prompts.
The build queue is now complete: every feature in every spec and the design handoff has a detailed prompt.

## Reconciliation with HANDOFF_AUDIT_AND_QA.md

docs/product/HANDOFF_AUDIT_AND_QA.md is a complementary consolidated audit (its own prompts 01-15). It is consistent
with this index; its prompts map onto prompts 20-25 plus the cross-cutting ones here. Use THIS index for numbering;
use the audit doc for two unique things it adds:
- The grounded "existing coverage observed" snapshot (what apps/services exist today).
- The explicit per-feature event lists, table lists, and especially the end-to-end QA / acceptance matrix (its
  prompt 15: 14 e2e tests). Treat that matrix as the cross-surface verification layer, the equivalent of a final
  acceptance gate spanning all surfaces.

Two things the audit doc OMITS that this index requires, do not skip them:
- The foundational design-system prompt (24) must run BEFORE any surface UI, or the four apps drift. The audit doc
  starts at viewer parity without it.
- The design handoff (docs/product/design/: exact tokens + INTERACTION_MAP routes/wiring) is the visual + routing
  source of truth. The audit doc is functional decomposition only; build to the handoff's tokens and routes.

# Axessplayer: Reconciled Production Build Plan
**Version 1.0 · June 2026**

This document merges the Master Build Spec, SOTA Gap Analysis, Gamification, and the autonomous orchestrator prompt into a single, ordered sequence of execution for the `axessplayer` monorepo. It respects the frozen-contract boundary and the reuse mandate from `mvpsigndemo-20`.

## 0. The Baseline (Current State on feat/adaptive-accessibility-publish)
- **Done**: Upload pipeline, vertical player, Captions With Intention (CWI), Sign Language PiP, Audio Description, Series publication (0006-0008), Content CRUD.
- **Frozen**: Contracts (`contracts/`), Schema (`supabase/migrations/0001` to `0008`), Ledger RPCs (`spend_coins`, `grant_coins`).
- **Reuse Source**: `mvpsigndemo-20` edge functions, schema, and API integrations are cleared for porting into this monorepo.

## 1. Wave A: The Flywheel and Proof (Data & Lift)
1. **B1. Prod Cluster Security**: Enable Kubernetes audit logging and patch cadence on `swissbrain-prod` (CH-GVA-2).
2. **B2. Events Collector**: Stand up the edge collector for beat-level signals (completion, decision_id, propensity, reward). Route to warehouse.
3. **B3. Adaptive Lift Dashboard**: Prove the narrative re-cut. Run A/B (treatment vs director's cut), measure completion and return. Wire Off-Policy Evaluation (OPE).

## 2. Wave B: Mobile Parity and Content Ingestion
1. **Mobile App (`apps/mobile`)**: Advance the Expo app to parity with the web player. Implement the CWI and Sign PiP renderers natively. Wire the wallet and paywall to real services.
2. **B4. Content Ingestion**: Port the multipart upload and processing edge functions from `mvpsigndemo-20`. Ingest real micro-series to Exoscale object storage.

## 3. Wave C: B2B Revenue and Placement
1. **B5. Placement Authoring**: Studio UI to declare `placement_slots` on beats. Assign campaigns by market/cohort.
2. **Placement Serving**: Decision engine fills slots at serve time. Log to `decision_log` and `consent_ledger`. FTO-safe (slot-at-authoring) only.
3. **B6. Brand Marketplace**: Self-serve surface for brands to buy slots.

## 4. Wave D: Wallet and Trust
1. **B7. Wallet Completion**: Wire rewarded ads (Earn), Stripe/RevenueCat (Buy), and Subscriptions. Re-use `mvpsigndemo-20` Stripe webhook handlers, adapted to the economy ledger.
2. **Trust & Provenance**: C2PA signing at render. Consent ledger hash-chain validation as a strict precondition for serving personalized/placed variants.

## 5. Wave E: Frontier (Gated on B3 Lift)
1. **B8. Be-The-Protagonist**: Credit-gated face personalization. Biometric consent enrollment. Face-swap onto cached base (not live generation).
2. **Narrative World Model**: Offline reward model training and bandit updates on BSC.

## Execution Rules
- **No Em Dashes**: Anywhere.
- **Verify, Do Not Assert**: Full `pnpm test` must pass before merge.
- **Stop Gates**: Stop and escalate for secrets, real money, infra provisioning, or contract/schema changes.

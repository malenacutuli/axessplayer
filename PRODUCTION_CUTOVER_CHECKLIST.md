# Axessplayer: Production cutover checklist

The ordered list of HUMAN-GATED steps that take the system from production-READY to production-LIVE.
The orchestrator builds everything around these (env-var SCHEMAS, config wiring, marked placeholders,
test stand-ins) but never crosses them. A human supplies values, provisions infra, ratifies, and
approves deploys. No em dashes.

Status legend: QUEUED = built around, waiting on the human. Each item names the smallest safe scope.

NOTE (2026-06-15): all four accounts exist (Supabase prod, Vercel, Stripe, auth provider). This turns
most of section 1 and 3 from "provision" into "provide config": a human pastes the secret VALUES into
the Vercel and Supabase env settings, and the orchestrator builds everything that consumes them
(env-var schemas, config wiring, deploy artifacts). The orchestrator still does NOT execute the
outward-facing/irreversible/money steps itself (create live Stripe products, run the prod migration,
deploy to prod) without an explicit per-action human go.

## 0. Path A media backend (reuse from Axessible / mvpsigndemo-20) - RATIFIED 2026-06-15
- [ ] QUEUED Provision + provide per docs/PATH_A_PROVISIONING.md, by slice: (1) AWS S3 bucket + IAM keys for
      real upload; (2) Supabase project + AssemblyAI key for transcription -> accessibility tracks; (4) Stripe
      keys for subscriptions; (5) Gemini/ElevenLabs for AI assists. The local upload loop already works
      gate-free; these replace it with S3 + real transcription.
- [ ] QUEUED Sign off + apply docs/proposals/0007_beat_variant_accessibility.sql.proposed (captions, audio
      descriptions, sign clips, characters, jobs, usage, users subscription columns) before moving it under
      supabase/migrations.

## 1. Secrets and credentials (orchestrator provides env-var SCHEMAS; human pastes VALUES into Vercel/Supabase env)
- [ ] QUEUED Production Postgres / Supabase connection string + service-role key.
- [ ] QUEUED Auth provider: JWKS endpoint / issuer / audience for real session + service JWT verification
      (services currently inject a test verifier behind the SessionVerifier/ServiceVerifier interface).
- [ ] QUEUED KV / Redis credentials for the decision serving cache (adapter wired behind config).
- [ ] QUEUED CDN origin + DRM key/license-server config (manifest currently serves fixture playback_urls).
- [ ] QUEUED Stripe keys (see section 2).

## 2. Money / Stripe (forbidden for the orchestrator to execute)
- [ ] QUEUED Create the Stripe catalog (6 coin packs + 3 VIP tiers) in TEST mode first; promote to LIVE
      only on explicit human approval. Connected account is the LIVE "Axessible Technologies"
      acct_1RvN9wCAKg7jOuBK; do NOT create live products without sign-off.
- [ ] QUEUED Wire the Stripe webhook -> /grant, idempotent on the Stripe evt_ id (W2_stripe_webhook).
- [ ] QUEUED Any real charge, payout, or refund execution.

## 3. Infrastructure and deploy (human-provisioned and human-approved)
- [ ] QUEUED Provision production infra (DB, KV, service runtimes, CDN).
- [ ] QUEUED Run the production migration chain 0001..0005 against prod Supabase (runbook to be authored in Wave D).
- [ ] QUEUED DNS / domain configuration.
- [ ] QUEUED Production deploy approval(s) and any access-control / permission changes.

## 4. Product and legal ratifications (orchestrator leaves as marked config constants)
- [x] RATIFIED 2026-06-15 W3 reward weights (w_c=1.0/w_r=0.5/w_m=0.3/w_p=2.0 + 7-day window) - business
      owner accepted the completion-first set; revisit with data later. config.ts marker flipped; reward
      shaping may now be finalized/optimized by the Wave D trainer.
- [x] RATIFIED 2026-06-15 Control holdout 10% global (operational default, accepted as-is).
- [ ] QUEUED EU AI Act explainability bar - LEGAL posture, with counsel. The ONE remaining placeholder in
      config.ts (EXPLAINABILITY_TOP_N). Awaits counsel ratification.
- [ ] QUEUED Privacy Policy + Terms ratification. DRAFT templates shipped at apps/web/public/legal/
      (privacy-policy.html, terms.html, policy version 2026-06-15.1). Counsel must review, fill the
      [PLACEHOLDERS] (controller, DPO, retention, jurisdictions, processors), and confirm before launch.
      On any change, bump POLICY_VERSION in apps/web/src/consent/model.ts to force re-consent.
- [ ] QUEUED Data retention windows + k-anonymity threshold. Recommendations are in
      docs/DATA_GDPR_DESIGN.md, all marked TUNABLE/PENDING-LEGAL. Ratify per data category.

## 5. Contract / schema / ledger changes (orchestrator-owned, human sign-off)
- [ ] QUEUED content.yaml enrichment: the create endpoints define NO request-body schemas, so create
      routes can only bind path-param + Error and cannot be contract-validated. Needed for W7 studio
      create-with-validation. Orchestrator drafts the version bump; human signs off.
- [ ] QUEUED Economy refund redesign: refund is currently a flat credit; it should reference the original
      spend. Touches ledger code -> sign-off gate.
- [ ] QUEUED Consent + demographics schema: draft proposed at docs/proposals/0006_consent_and_demographics.sql.proposed
      (consent_record append-only/hash-chained, pseudonymous coarse demographics). Sign off, then move under
      supabase/migrations and add the consent ENDPOINT contract (POST /consent, session-derived identity, F1).
      The web app records consent locally today via apps/web/src/consent and mirrors best-effort to
      VITE_CONSENT_BASE_URL when set.

## 6. Content, consent, and signing (real-world actions, human-gated)
- [ ] QUEUED Real content generation at GPU/model cost (pipeline built with mocked models behind a cost gate).
- [ ] QUEUED Real likeness consent capture (consent ledger built with a test path).
- [ ] QUEUED Real C2PA signing keys + KMS (trust service built with a test signer).
- [ ] QUEUED Biometric consent infrastructure for the "be the protagonist" face feature (GDPR Article 9 +
      BIPA): explicit separate opt-in captured at point of use, time-limited + hard-deletable, recorded on
      the consent_ledger hash chain BEFORE any personalized render serves; plus verified-permission face
      matching. Design in docs/DATA_GDPR_DESIGN.md + docs/DATA_ML_DYNAMIC_CONTENT_SPEC.md section 5b.

## 7. Container readiness (orchestrator-verified by real `docker build`/`run`, 2026-06-15)
- [x] DONE apps/web image builds (76MB, nginx + Vite dist) and is a clean static deploy. Caught + fixed a
      real `.dockerignore` bug (excluded the tests/ workspace dir, broke `pnpm install --frozen-lockfile`).
- [x] DONE service-image build pattern verified (manifest image builds, 864MB).
- [x] DONE (a) listeners bind 0.0.0.0 (was 127.0.0.1); (b) economy/decision/content gained guard-free
      src/serve.ts entrypoints; (c) Dockerfile CMD fixed to `node --import tsx src/serve.ts` (the pnpm
      --filter CMD did not spawn the child in-container). Serve code proven (direct node run prints the
      listening line + serves 200); image entrypoint config verified via docker inspect.
- [x] DONE container-run VERIFIED end to end (2026-06-15, after a Docker Desktop restart): manifest image
      `docker run` -> HOST curl returns HTTP 200 + valid HLS playlist, log `listening on 0.0.0.0:8787`,
      ready in ~1s. economy verified serving 401 (no token) inside the container. NOTE for re-runs: use a
      FREE host port (8080 is taken locally) and `curl --retry-all-errors` (Docker Desktop's proxy returns a
      reset, not connection-refused, during the brief startup window, so --retry-connrefused alone gives a
      false 000). The earlier failures were a transient daemon corruption + that curl flag, not the image.
- [ ] OPTIONAL (optimization, not required): emit compiled JS and run `node dist/serve.js` (drop tsx at
      runtime) for faster cold start + smaller images; and `pnpm deploy --filter` to prune the 864MB size.
- [ ] QUEUED (human) provide real secret VALUES per infra/ENV.md into Vercel/Supabase/container env.

---
Built-and-ready items (no human needed) are tracked in git history and MEMORY, not here. This file lists
only what a human must do to go live.

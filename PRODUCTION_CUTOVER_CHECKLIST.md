# Axessplayer: Production cutover checklist

The ordered list of HUMAN-GATED steps that take the system from production-READY to production-LIVE.
The orchestrator builds everything around these (env-var SCHEMAS, config wiring, marked placeholders,
test stand-ins) but never crosses them. A human supplies values, provisions infra, ratifies, and
approves deploys. No em dashes.

Status legend: QUEUED = built around, waiting on the human. Each item names the smallest safe scope.

## 1. Secrets and credentials (orchestrator provides env-var SCHEMAS, never values)
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
- [ ] QUEUED W3 reward weights (w_c/w_r/w_m/w_p + return window) - BUSINESS call. Placeholder lives in
      services/decision/src/config.ts. Ratify BEFORE any demo shows the number.
- [ ] QUEUED EU AI Act explainability bar - LEGAL posture, with counsel. Placeholder in config.ts.

## 5. Contract / schema / ledger changes (orchestrator-owned, human sign-off)
- [ ] QUEUED content.yaml enrichment: the create endpoints define NO request-body schemas, so create
      routes can only bind path-param + Error and cannot be contract-validated. Needed for W7 studio
      create-with-validation. Orchestrator drafts the version bump; human signs off.
- [ ] QUEUED Economy refund redesign: refund is currently a flat credit; it should reference the original
      spend. Touches ledger code -> sign-off gate.

## 6. Content, consent, and signing (real-world actions, human-gated)
- [ ] QUEUED Real content generation at GPU/model cost (pipeline built with mocked models behind a cost gate).
- [ ] QUEUED Real likeness consent capture (consent ledger built with a test path).
- [ ] QUEUED Real C2PA signing keys + KMS (trust service built with a test signer).

---
Built-and-ready items (no human needed) are tracked in git history and MEMORY, not here. This file lists
only what a human must do to go live.

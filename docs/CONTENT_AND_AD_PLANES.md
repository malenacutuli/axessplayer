# Content plane vs ad plane: the architecture correction, and OSS verdicts

**Version 1.0 - June 2026 - Axessible Technologies.** Evaluation of a proposed AI-video-agent +
character-swap + ad-delivery stack. The layers are real; the proposed WIRING is wrong in one load-bearing
way and we reject that. No em dashes.

## 0. The load-bearing rule (a hard invariant)

The proposed pipeline ended with an ad proxy slicing the personalized character render into the live user
manifest. That is wrong and breaks four ways:
- SGAI (server-guided ad insertion) emits HLS INTERSTITIALS (ad breaks between segments), not in-place
  content. A face-swapped protagonist is the MAIN content of the beat, a beat_variant, not an ad break.
- An ad server's CTR optimizer is the wrong decision brain. Our bandit deliberately under-weights
  watch-time/CTR in favor of return + satisfaction. An ad-CTR optimizer must never choose which cut a
  viewer sees.
- Real-time neural render + live stitch is not feasible at a live buffer budget today (seconds-per-frame
  diffusion). The correct shape is render-on-demand into a per-user cache, credit-gated.
- Biometric face-swap output carries BIPA + GDPR Article 9 consent and C2PA provenance. Routing it through
  an ad pipeline muddies the legal chain the consent ledger exists to keep clean.

THE INVARIANT (enforced, see PRODUCTION_CUTOVER_CHECKLIST): two separate planes.
- CONTENT PLANE (ours): beats and beat_variants, INCLUDING personalized renders, chosen by OUR decision
  engine and served from cache through the player. Consent + provenance is a SERVE PRECONDITION.
- AD + PLACEMENT PLANE (separate): break ads via interstitials (SGAI), in-scene placement composited into a
  beat_variant at render time. Chosen by an ad-decisioning layer, never the content bandit.
Personalized content rides the content plane. SGAI never touches the protagonist render.

## 1. Layer 1 - video agents (Director: reference, not runtime)

video-db/Director [verified]: a video-agent framework, reasoning engine orchestrating 20+ registered agents
(search/clip/generate/dub/subtitle), streaming progress events. ADOPT AS REFERENCE for the Axess Director
generation orchestrator (agent-registration API, run() contract, typed Text/Video/Image outputs, progress
emission) - it matches our specced screenwriter/casting/storyboard/cinematographer/editor shape. WATCH: it
leans on VideoDB's hosted backend; decouple from that lock-in, ride our own content graph + decision engine
+ player. calesthio/OpenMontage [unverified]: park; the auto-trailer idea is a future Studio feature, not
architecture.

## 2. Layer 2 - character swap (Phase D self-host, license-gate the WEIGHTS)

MoCha, Wan-Animate, CharacterFaceSwap: the self-host face-swap research track from Master Spec 3.1. Treat as
the Phase D option evaluated for quality + unit-economics against the bought API we ship first. NOT on the
launch critical path. License-gate EVERY WEIGHT (research character-animation weights frequently restrict
commercial use; the repo license is not the weight license). Whatever the model, output still passes the
non-negotiables: consent ledger, verified-permission face matching, C2PA signing, per-user cache. The model
is swappable; the consent + provenance wrapper is not.

## 3. Layer 3 - ad delivery (Eyevinn sgai-ad-proxy: real keeper, ads only)

Eyevinn/sgai-ad-proxy [verified, Apache-2.0]: HTTP proxy inserting ads as SGAI HLS interstitials, VAST
integration, dynamic insertion, quartile tracking. Permissive and credible. ADOPT for the AD PLANE: break-
style ad inventory + the VAST/tracking plumbing, player-agnostic (hls.js / AVPlayer), our ad-decisioning
stays ours. DO NOT use for personalized story content (Section 0). In-scene product placement that
composites a brand into the frame is a render-time variant op (Remotion/edge into a beat_variant), not an
interstitial. seanZhang414/openadserver [low confidence]: DO NOT ADOPT - shaky provenance, and its CTR
objective is exactly the watch-time objective we rejected. If we ever need an ad server, evaluate Eyevinn's
own test-adserver / ad-normalizer (Apache-2.0).

## 4. Adoption verdict, one line each

- video-db/Director: adopt as reference architecture + agent ergonomics; decouple from VideoDB infra.
- Eyevinn/sgai-ad-proxy: adopt for the break-ad plane; never for personalization.
- MoCha / Wan-Animate / CharacterFaceSwap: Phase D self-host research; license-gate weights; behind the
  bought API at launch.
- calesthio/OpenMontage: park until verified.
- seanZhang414/openadserver: do not adopt; we have first-party capture + the bandit, reward-shaped for
  return not CTR.

See docs/ENGINE_SOTA_AND_PATENTABILITY.md for the full subsystem adopt-vs-invent map and the IP brief.

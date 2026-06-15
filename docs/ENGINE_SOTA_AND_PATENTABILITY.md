# Engine SOTA map and where our defensible, patentable invention lives

**Version 1.0 - June 2026 - Axessible Technologies.** Best-in-class OSS per subsystem, the adopt-vs-invent
call, and the honest read on what is actually defensible. Thesis: commodity layers are solved and
permissively licensed; the patentable thing is the INTEGRATED METHOD, not any single repo. No em dashes.

## 0. The truth about "patentable" (read first)

- Assembling open-source components does NOT produce a patent. A patent needs a novel, non-obvious
  invention; published OSS is prior art. Copyleft (GPL/AGPL) is hostile to a proprietary product. Use
  permissive repos as commodity infrastructure; reserve invention for the parts no one has assembled.
- The defensible asset is the INTEGRATED SYSTEM + a few specific methods, not the bandit/player/diffusion
  model (each exists). The combination - consent-and-provenance-gated, return-optimized not watch-time,
  seamless per-viewer re-cutting, generation-fused - does not exist as a shipped system. That gap is the
  moat and the patent surface.
- I am NOT a patent attorney. Section 2 is the BRIEF FOR COUNSEL, not granted claims. A real filing needs
  patent counsel + a formal prior-art search. File BEFORE public launch; disclosure starts clocks and can
  bar protection in some jurisdictions.

## 1. SOTA map: adopt the commodity, invent the connective tissue

| Subsystem | Best OSS | License | Our call |
|---|---|---|---|
| Contextual bandit core | banditml, MABWiser, contextualbandits | permissive | ADOPT a lib; invent the ARM SET (re-cut/placement/personalization as arms) |
| Off-policy eval | st-tech/zr-obp, scope-rl | Apache | ADOPT (matches our propensity-logged IPS/DR, already built) |
| Feature serving (hot path) | feast-dev/feast | Apache | ADOPT for the viewer-vector sub-ms path |
| Player / MSE | video-dev/hls.js, xgplayer | permissive | ADOPT hls.js as the MSE core; INVENT branch prefetch-and-switch |
| Provenance signing | contentauth/c2pa-rs | permissive | ADOPT as the C2PA layer (trust service today has a test signer) |
| Ad delivery | Eyevinn/sgai-ad-proxy | Apache | ADOPT for the ad plane only (see CONTENT_AND_AD_PLANES) |
| Generation orchestration | video-db/Director, ViMax, MovieAgent | mixed | STUDY; model Axess Director on these multi-agent shapes |
| Character swap | MoCha, Wan-Animate, CFS | weights often non-commercial | Phase D self-host; license-gate weights |
| Streaming-diffusion render | RollingForcing, Causal-Forcing, StreamAvatar | research, verify | FRONTIER track (Section 2) |

Spending invention budget rebuilding a bandit, feature store, HLS player, or C2PA signer is waste. Invention
goes to the connective method and the frontier render path.

## 2. The frontier shift: real-time streaming video diffusion

The most important finding. "Be the protagonist" was specced as offline render to a per-user cache BECAUSE
real-time diffusion was impossible. As of 2026 that is breaking: Rolling Forcing (TencentARC, rolling
denoising + attention sink for coherent multi-minute real-time video), Causal Forcing (THU, 1-2 step
distilled real-time interactive generation), StreamAvatar (real-time interactive avatar streaming). [Likely]
within the build horizon a personalized protagonist could be a LIVE, beat-adaptive stream, not a pre-baked
file - "your face in a cut that adapts beat-by-beat as you watch." Strategic call: keep the cached-render
path as the shipping default (works today, cost-predictable); stand up a frontier track that fuses a
streaming-diffusion renderer into the branch graph behind the SAME consent + provenance gate. That fusion is
the strongest patent claim (Claim D).

## 3. Candidate claims (the brief for patent counsel)

Each = the invention, then the prior art it must clear.

- CLAIM A. Consent-gated, provenance-signed, per-viewer GENERATIVE RE-CUTTING of branching video with
  seamless playback. A bandit selects per viewer/beat among variants that include on-demand generated and
  face-personalized renders; a HARD PRECONDITION checks a consent + rights hash chain and refuses any
  personalized/placed variant missing its three consents (viewer biometric, actor likeness, production
  rights); every served generative frame is C2PA-signed at serve time; the player prefetches and switches
  seamlessly. Clears: Eko branching (explicit choice, no per-viewer generation), recsys bandits (pick a
  catalog item, not a re-cut), face-swap tools (isolated render, no decision engine, no consent precondition).
  [Likely novel]: no prior system makes the consent/provenance check a load-bearing precondition INSIDE the
  per-viewer selection loop.
- CLAIM B. Reward-shaped adaptive engagement under a REGULATORY-COMPLIANCE CONSTRAINT. One policy selects
  the next cut AND the next engagement action (cliffhanger intensity, reward surfacing, nudge timing),
  optimized for D1/D7 return + satisfaction, with regret penalties and deliberate watch-time
  under-weighting, the reward weights a LOGGED, human-ratified artifact. Clears: engagement-maximizing
  recommenders (watch-time/CTR), the Hook model (behavioral, not a logged policy). [Likely novel]: encoding
  regulatory compliance (DSA, Digital Fairness Act) as an explicit auditable reward constraint + treating
  weight-setting as a ratified logged governance act.
- CLAIM C. ONE decision substrate selecting cut, placement, AND personalization jointly, over a unified arm
  set, under shared brand-safety + canon-safety hard filters, propensity-logged for honest OPE. Clears: VPP
  (placement only, no narrative coupling), recsys (content only). [Likely novel]: unifying narrative,
  advertising, and identity personalization under one propensity-logged policy with shared canon-safety is
  not what ad-tech or streaming-tech stacks do.
- CLAIM D (frontier, highest value/risk). STREAMING-DIFFUSION personalization FUSED into a branch graph: a
  real-time autoregressive video-diffusion renderer produces the protagonist track as a live stream whose
  conditioning is updated beat-to-beat by the decision engine's branch choice, gated by the same consent +
  provenance preconditions, so the personalized cut adapts DURING playback. Clears: streaming-avatar work
  (no branch-graph/decision coupling, no consent gate), our cached path (not live). [Plausibly novel]: the
  inventive step is closing the loop between a narrative decision engine and a live generative renderer under
  a rights gate.

Honest caveat: [Guessing] on grant probability without a formal search. Method/software claims are
scrutinized hard; show a concrete technical effect, not an abstract idea. The most concrete - and most
likely to survive - are the consent-gate-as-precondition, the seamless-switch latency mechanism, and the
propensity-logged joint policy. Lead the filing with those (Claims A, C, parts of B); D as a continuation as
the frontier track matures.

## 4. Build recommendation

1. ADOPT, do not rebuild: hls.js, feast, zr-obp/scope-rl (we already have IPS/DR), c2pa-rs, a bandit lib,
   sgai-ad-proxy. All permissive. Weeks saved.
2. INVENT + protect: the arm set (re-cut/placement/personalization as arms), the consent+provenance serve
   precondition, the seamless branch prefetch-and-switch, the compliance-constrained reward, the joint
   propensity-logged policy. = Claims A-C.
3. FRONTIER track: integrate a streaming-diffusion renderer behind the consent gate, targeting Claim D.
   Keep cached render as the shipping default until it clears quality + cost bars.
4. LICENSE-GATE every model weight and dependency before it is load-bearing (standing rule). Permissive code
   is safe; research weights frequently are not.
5. ENGAGE PATENT COUNSEL NOW on Claims A, B, C; D as continuation. File before public launch.

## 5. Why the combination is the moat

Every piece exists somewhere; the integrated, consent-gated, compliance-constrained, generation-fused system
exists nowhere, and the connective methods are the patent surface. A clone cannot bolt consent + provenance
on after the fact, which is why building it as a PRECONDITION rather than a feature is both the ethical and
the strategic choice. This aligns with what already shipped: the consent/GDPR foundation (apps/web/src/
consent), the consent_ledger + C2PA trust service, the propensity-logged decision_log, and the
return-shaped ratified reward weights.

# The Narrative World Model: the research bet, compute plan, and what is out of reach

**Version 1.0 - June 2026 - Axessible Technologies - technical cofounder brief.** Honest about every bound.
No em dashes.

## 0. The one bet

**The Narrative World Model (NWM): a real-time, consent-locked, decision-conditioned interactive video
generator, trained and continuously improved on a proprietary beat-level engagement dataset, with
model-native provenance.** World-first because three individually-known components are fused in an
unpublished way only our platform can train:
1. **Narrative conditioning.** Real-time autoregressive video models (Self-Forcing, Causal/Rolling Forcing)
   condition next-frame generation on a low-level action. The NWM conditions on a NARRATIVE-STATE VECTOR
   emitted by our contextual-bandit decision engine per viewer per beat. The "action" is a story decision
   chosen by an RL policy, not a joystick. No published system closes this loop.
2. **A non-copyable training signal.** Re-cutting per viewer at beat granularity with logged propensity
   emits (viewer context, beat decision, propensity, counterfactual reward) tuples no fixed-catalog platform
   can produce. This trains a narrative-engagement reward model and powers offline RL on the conditioning
   policy. The generator is rentable; this reward model + data flywheel are not.
3. **Model-native consent + provenance.** Identity locked from a consented embedding, injected as a
   conditioning stream; an in-model watermark (Stable Signature / Gaussian Shading lineage) bound at the
   generation step, surviving recompression; the consent + rights hash chain a HARD PRECONDITION of the
   render. The legal layer lives in the weights and the serving loop, not a wrapper a clone can skip.

Defensible claim, one line: **the first system in which a narrative reinforcement-learning policy drives a
real-time generative video model per viewer, under a consent-and-provenance precondition, trained on
beat-level adaptive engagement data.** Patentable (Claims A + D in docs/ENGINE_SOTA_AND_PATENTABILITY.md),
publishable, compounding.

## 1. The honest compute reality

- **BSC MareNostrum 5 (ACES, H100)**: competitive, time-boxed allocations (EuroHPC/RES/BSC). Excellent for
  distillation, fine-tuning, reward-model training, ablations, periodic retraining. NOT a 24/7 inference
  plane, NOT unbounded pretraining.
- **The Swiss GPU = Exoscale** (confirmed 2026-06-15): development + low-latency inference plane (prototype,
  closed-beta serving, evals, adapters). Exoscale is a Swiss/EU IaaS, so this is a DATA-RESIDENCY win - the
  consent-gated, biometric, GDPR-Article-9 render pipeline stays in CH/EU, aligned with the consent + GDPR
  posture. And because Exoscale is itself a cloud, it can serve BOTH the closed beta AND the production burst
  (scale up GPU instances), so we may not need a separate hyperscaler for serving. OPEN: the specific
  Exoscale GPU model + VRAM + quota, which decides real-time-capable serving vs cached-only (see Section 5).
- **In reach** [Likely]: take a strong open video base (Wan 2.2 lineage), distill to a few-step real-time
  model, add two conditioning adapters (identity, narrative-state), train the reward model on our logs,
  research-grade eval. Fine-tuning + distillation scale (hundreds to low-thousands of GPU-hours/cycle).
- **Out of reach, do not attempt** [Certain]: pretraining a foundation video model from scratch (10k+
  GPU-months), or beating a frontier face-swap vendor on raw quality. Stand on an open base; add the parts
  that are ours.
- Division of labor: **BSC trains + distills, Switzerland develops + serves the beta, cloud bursts for
  production.** Aim the supercomputer only at what compounds.

## 2. Architecture (four trainable pieces on a frozen open base)

- **2.1 Base generator.** Frozen open-weight video diffusion backbone (Wan 2.2 lineage). Adapt + accelerate,
  do not retrain world knowledge.
- **2.2 Real-time distillation.** Causal/self-forcing distillation (asymmetric distribution matching, causal
  consistency) to a 1-4 step frame-causal autoregressive sampler with an attention-sink for long-context
  stability. Target: interactive frame rate on the Swiss GPU for a 9:16 beat. Single hardest engineering
  risk; most ablation budget.
- **2.3 Two conditioning adapters (the novelty).** Identity adapter: a consented face -> locked identity
  (ArcFace embedding + light 3D prior), injected IP-Adapter/ControlNet style, temporal identity consistency
  as an explicit loss. Narrative-state adapter: the decision engine emits a per-beat narrative-state vector
  (branch, intensity, pace, emotional target, canon constraints); a cross-attention adapter conditions
  generation on it, so the same identity renders calm or explosive on the policy's command. THIS adapter is
  the patentable fusion point.
- **2.4 Narrative-engagement reward model.** Bradley-Terry preference model on our beat-level logs: given
  (context, two candidate beat outcomes), predict return + satisfaction, regret penalties, watch-time
  under-weighted. Shapes the bandit reward and, via offline RL (IPS/DR OPE first, then a guarded
  policy-gradient fine-tune of the narrative policy), tells the generator which emotional shapes to produce.
- **2.5 Model-native provenance.** In-model watermark (Stable Signature decoder fine-tune, or Gaussian
  Shading at sampling) so every frame is detectably ours and recompression-robust, atop the C2PA manifest
  signed at serve. Consent hash-chain check is a hard precondition before any conditioned render runs.

## 3. The data flywheel (the actual moat)

```
player serves a per-viewer cut
 -> beat-level capture (context, decision, propensity, reward, regret)
 -> warehouse
 -> reward model retrained (what drives return, per cohort)
 -> OPE of a new narrative policy (IPS / DR, propensity-logged)
 -> narrative-state adapter + bandit policy updated on BSC
 -> redeploy behind the OPE safety gate
 -> better per-viewer cuts -> more, richer data
```
No incumbent has the INPUT to this loop because none re-cuts per viewer at beat granularity. Protect the
loop and the reward model, not the generator.

## 4. Evaluation (research-grade or it does not count)

Adaptive lift (treatment vs control on completion, D7 return, revenue, with CIs - the headline number);
generation quality (ArcFace identity consistency, temporal flicker/warping error, narrative-state adherence,
human preference vs the bought-API baseline); latency (fps + time-to-first-frame on the Swiss GPU at target
res); provenance (watermark detection after recompression, C2PA pass rate); safety (consent-precondition
false-negative rate MUST be zero served-without-consent, canon-filter violation rate); off-policy honesty
(every policy change OPE-estimated before it serves).

## 5. The decision needed to size the plan (Section 6 of the brief)

Serving plane = Exoscale (Swiss/EU, data-residency win, dev + beta + production burst). Two inputs still
size the plan:
- **The specific Exoscale GPU model + VRAM + quota.** This decides serving architecture: Ada/Hopper class
  (L40S 48GB / A100 / H100) -> can prototype REAL-TIME distilled-sampler serving on Exoscale (frontier path
  testable in CH/EU); A40 48GB -> real-time marginal, serve cached + light inference; V100/older 16-32GB ->
  Exoscale serves the CACHED renders (generated on BSC) plus the player path, no live diffusion. R5's
  serving plan locks to this.
- **The BSC MareNostrum 5 allocation scale + cadence.** A few hundred H100-hours/quarter -> prioritize
  distillation + the reward model, lean on a bought API for identity. A standing large allocation -> also
  train the identity + narrative adapters aggressively, target the live frontier sooner.
Everything else holds regardless.

## 6. Honest bottom line

We cannot out-pretrain a frontier lab and must never claim to [Certain]. But with BSC for training, a
dedicated GPU for serving, an open base, and a data flywheel no incumbent can feed, we can build the first
narrative-RL-conditioned, consent-gated, provenance-native real-time video engine, and publish + patent the
fusion. The moat is the loop and the reward model, not the generator. Aim the supercomputer there. Agent org
to deliver it: AGENTS/RESEARCH_ORG.md.

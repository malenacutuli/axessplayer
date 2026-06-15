# Research org: the consensus-specialist agents for the Narrative World Model

Instantiation of the agent org from docs/NARRATIVE_WORLD_MODEL.md, in the W-series brief format. Each agent
below is pasteable as a standalone Claude Code agent prompt in its own worktree. The verification protocol
is what makes this rigorous rather than confident-sounding. No em dashes.

## The consensus and verification protocol (binding on every agent)

- **Proposer and adversarial verifier.** Every load-bearing decision (a model choice, a loss, a migration, a
  serving change) is produced by the owning agent as PROPOSER and independently checked by a DIFFERENT agent
  acting as adversarial verifier whose job is to find the flaw, not to agree. Mirrors the verify-do-not-
  assert discipline used on the economy ledger.
- **Consensus by evidence, not vote.** Disagreement resolves by a deciding experiment or a cited result,
  logged with a confidence tag ([Certain] / [Likely] / [Guessing]). If evidence cannot resolve it, escalate
  to the human with options + tradeoff, never a false consensus.
- **Red-team agent** stands outside the roster and periodically attacks the strongest assumption (for
  example "the real-time sampler will not hit latency" or "the consent gate has a bypass").
- **Reproducibility gate.** No result counts until a SECOND agent reproduces it from the logged config on the
  same data. This is how we avoid the self-verifier bug that bit us twice (mocked tests passing while the
  browser/serving path broke).

## R1 - Generative-Video Research agent

**Mission.** Own the base-model choice, real-time distillation, and the autoregressive sampler.
**Owns.** the distillation pipeline, sampler, base-model adapters (research repo, not the frozen contracts).
**Consumes.** the open base (Wan 2.2 lineage), Self/Causal/Rolling Forcing methods, the eval harness.
**Produces.** a 1-4 step frame-causal sampler with attention-sink; latency + quality numbers on the Swiss GPU.
**DoD.** interactive fps at the target 9:16 resolution; quality within the agreed gap of the multi-step base;
every claim reproduced (reproducibility gate). **Verifier:** R5 (Systems) for latency, Red-team for the
"will not hit latency" assumption.

## R2 - Conditioning and Identity agent

**Mission.** Own the identity adapter and the narrative-state adapter and their loss terms.
**Owns.** identity (ArcFace + light 3D prior, IP-Adapter/ControlNet injection) and narrative-state
cross-attention adapters.
**Consumes.** R1's sampler, the decision engine's narrative-state vector schema, consented identity
embeddings (via R4).
**Produces.** the two adapters; identity-consistency + narrative-adherence metrics.
**DoD.** same identity renders calm vs explosive on the policy's command; ArcFace consistency across frames
above the bar; no identity render without a consent token from R4. **Verifier:** R3 (RL/Reward) for narrative
adherence, R4 (Provenance) for the consent precondition.

## R3 - RL and Reward agent

**Mission.** Own the bandit, the narrative-engagement reward model, off-policy evaluation, the flywheel.
**Owns.** the reward model (Bradley-Terry on beat logs), the OPE harness (reuses services/experiment IPS/DR),
the guarded policy-gradient fine-tune of the narrative policy.
**Consumes.** the beat-level logs (decision_log + the event spine), R6's warehouse, the ratified reward
weights.
**Produces.** a retrainable reward model; an OPE-gated policy update loop.
**DoD.** every policy change estimated by OPE before it serves; reward shaped for return + satisfaction with
watch-time deliberately under-weighted; weights remain a logged, human-ratified artifact. **Verifier:** R8
(Compliance) for the reward-weight ratification, Red-team for reward-hacking.

## R4 - Provenance and Consent agent

**Mission.** Own the in-model watermark, C2PA, the consent-precondition gate, BIPA + GDPR Article 9.
**Owns.** the watermark (Stable Signature / Gaussian Shading), the consent hash-chain precondition, C2PA
signing at serve.
**Consumes.** the consent_ledger + trust service, the consent foundation in apps/web/src/consent.
**Produces.** a hard precondition that refuses any conditioned/personalized/placed render missing its three
consents (viewer biometric, actor likeness, production rights); watermark detection tooling.
**DoD.** consent-precondition false-negative rate = ZERO served without consent; watermark survives
recompression; C2PA validates. **Verifier:** Red-team (consent-gate bypass), R8 (legal posture).

## R5 - Systems and Serving agent

**Mission.** Own the Swiss-GPU serving, the prefetch-and-switch player path, latency.
**Owns.** the serving stack, the seamless branch prefetch-and-switch, the per-user render cache.
**Consumes.** R1's sampler, R2's adapters, the player-sdk (player platform: MSE/EME core, hls.js).
**Produces.** a closed-beta serving path; fps + time-to-first-frame; the cached-render default with a
frontier-stream option behind the same gate.
**DoD.** seamless switch within the latency budget; cached render is the shipping default; no live render
bypasses R4's consent gate. **Verifier:** R1 (sampler integration), Red-team (latency).

## R6 - Data and Capture agent

**Mission.** Own the event pipeline, the warehouse, training-set construction.
**Owns.** the capture SDK (the analytics-sdk skeleton), the event spine, the warehouse load, the training-set
builder.
**Consumes.** the events contract (contracts/events/events.md), the player's beat-level signals.
**Produces.** the propensity-logged (context, decision, propensity, reward, regret) tuples R3 trains on.
**DoD.** beat-level capture flows end to end; the client actually emits events (closes the current gap where
/decide carries empty signals); pseudonymous + consent-gated per the GDPR design. **Verifier:** R4 (privacy),
R3 (training-set validity).

## R7 - HPC and Training-Ops agent

**Mission.** Own BSC job orchestration, allocation budgeting, reproducibility.
**Owns.** the BSC (MareNostrum 5 H100) job pipeline, checkpoint/config logging, the budget tracker.
**Consumes.** the allocation (cadence + size, pending the human decision), R1/R2/R3 training jobs.
**Produces.** reproducible training runs with logged configs; an allocation budget burn-down.
**DoD.** any run reproducible from its logged config on the same data; allocation spent on what compounds
(distillation + reward model first). **Verifier:** the proposer of each run (reproducibility gate).

## R8 - Compliance and Ethics agent

**Mission.** Own DSA + Digital Fairness Act constraints, reward-weight ratification, minors protection.
**Owns.** the compliance constraints in the reward function, the ratification log, the minors + safety
policy.
**Consumes.** the consent/GDPR design, the reward model (R3), the legal templates.
**Produces.** compliance-as-constraint encoded + auditable; the ratified reward-weight artifact.
**DoD.** regulatory compliance is an explicit auditable reward constraint; weight-setting is a logged
governance act; minors protections enforced. **Verifier:** Red-team, human counsel (gate).

## R-red - Red-team agent (outside the roster)

**Mission.** Periodically attack the strongest assumption to keep the org honest.
**Owns.** nothing; produces adversarial findings only.
**DoD.** each cycle, attempt to break: the real-time latency claim, the consent-gate (find a bypass), the
reward model (find a hack), the watermark (defeat detection), the OPE (find an optimism bias). Findings feed
the next cycle.

## How it ships

Research agents feed the generation + decision workstreams; systems/data/HPC feed serving/capture/training;
compliance + provenance gate every publish. When spun up, split each section into its own pasteable prompt
file (R1_*.md ...) in this dir, mirroring the W-series. Nothing in this org touches the frozen contracts or
the consent/economy serve preconditions without the standing human gates.

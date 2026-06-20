// PROMPT 26 / GOLD_STANDARD_16: the MODEL-AGNOSTIC ROUTER. The moat is here, not in any base model. One
// provider-agnostic interface over video/image/voice/lip-sync models, so a model swaps by CONFIG, never a
// code change. It does three durable things:
//
//   1. A model REGISTRY that is pure config: each entry is {provider, model_id, modality, ...capabilities,
//      ...pricing, invocation style}. Prices/model ids/versions are FLAGGED 2026 placeholders and MUST be
//      re-verified at build time; the architecture is version-independent on purpose.
//   2. DECISION-TREE ROUTING by brief: shot list >= 3 cuts -> a multi-shot model; heavy-physics (fire,
//      fluid, crowd) -> a best-physics model; preview -> cheapest; else cheapest that satisfies the brief.
//      A providerHint pins one provider so the SAME brief can run on two providers via config swap.
//   3. NORMALIZATION: real providers differ on sync vs submit-poll vs webhook and on param names. The
//      ProviderClient port collapses all three into submit() + poll() and returns ONE NormalizedOutput
//      shape. Identical sub-generations are cached so a retry or a repeat never pays twice.
//
// The router never calls a model directly: a ProviderClient is injected (the real one wraps the Supabase
// edge functions, the fake one is deterministic for tests), the same inversion the cost gate relies on.
// No em dashes.

export type Modality = "video" | "image" | "voice" | "lipsync";

// How a provider returns a result. submit-poll and webhook both normalize to submit() + poll() below.
export type Invocation = "sync" | "poll" | "webhook";

// One model in the registry. PURE CONFIG. capabilities are free-form flags the router routes on (for
// example "multi_shot", "physics", "first_last_frame", "animated", "talking_head"). Pricing is a flagged
// placeholder: re-verify per model/per second at build time.
export interface ModelEntry {
  id: string; // our stable handle, for example "runway-gen4" (NOT the vendor id)
  provider: string; // "runway" | "fal" | "replicate" | "elevenlabs" | "stability" | ...
  model_id: string; // the vendor model id passed to the provider
  modality: Modality;
  invocation: Invocation;
  capabilities: string[];
  costPerSecondUsd: number; // FLAGGED placeholder pricing
  costPerCallUsd: number; // fixed per-call overhead, FLAGGED placeholder
  maxDurationS: number | null; // null = no advertised cap
  // Which render tier this model is appropriate for. "preview" = cheap drafts, "final" = premium, "both".
  renderTier: "preview" | "final" | "both";
}

export type ModelRegistry = ModelEntry[];

// The routing input. The planner/cinematographer agents fill this from a shot brief.
export interface GenerationBrief {
  modality: Modality;
  durationS: number; // requested segment length
  shotCount?: number; // cuts in the shot; >= 3 prefers a multi-shot model
  needs?: string[]; // required capabilities, for example ["physics"] for fire/fluid/crowd
  preview?: boolean; // a cheap draft, not a final
  providerHint?: string; // pin a specific provider (the config-swap lever for A/B and fallback)
}

export interface RouteDecision {
  model: ModelEntry;
  reason: string;
  estimatedUsd: number;
}

// Estimated cost of one generation of `durationS` on a model.
export function estimateModelCostUsd(model: ModelEntry, durationS: number): number {
  return model.costPerCallUsd + model.costPerSecondUsd * Math.max(0, durationS);
}

export class NoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRouteError";
  }
}

// THE DECISION TREE. Deterministic and config-driven: the same brief + registry always picks the same model
// (ties broken by cheapest then by id), so routing is testable and a provider swap is a registry edit.
export function chooseModel(brief: GenerationBrief, registry: ModelRegistry): RouteDecision {
  let candidates = registry.filter((m) => m.modality === brief.modality);

  // Honor a hard provider pin first: this is how the same brief runs on provider A vs provider B.
  if (brief.providerHint) {
    candidates = candidates.filter((m) => m.provider === brief.providerHint);
    if (candidates.length === 0) {
      throw new NoRouteError(`no ${brief.modality} model for provider ${brief.providerHint}`);
    }
  }

  // Duration ceiling: a model that advertises a max below the request cannot do it in one pass.
  candidates = candidates.filter((m) => m.maxDurationS == null || brief.durationS <= m.maxDurationS);

  // Required capabilities (for example physics) are hard filters.
  for (const need of brief.needs ?? []) {
    candidates = candidates.filter((m) => m.capabilities.includes(need));
  }

  if (candidates.length === 0) throw new NoRouteError("no model satisfies the brief");

  const reasons: string[] = [];

  if (brief.preview) {
    // Previews want the cheapest renderer that can preview at all.
    const previewable = candidates.filter((m) => m.renderTier !== "final");
    if (previewable.length > 0) candidates = previewable;
    reasons.push("preview->cheapest");
  } else {
    // Finals prefer the premium-capable renderers, then specialize.
    const finalable = candidates.filter((m) => m.renderTier !== "preview");
    if (finalable.length > 0) candidates = finalable;

    // Multi-cut shots route to a multi-shot model when one is available.
    if ((brief.shotCount ?? 1) >= 3) {
      const multi = candidates.filter((m) => m.capabilities.includes("multi_shot"));
      if (multi.length > 0) {
        candidates = multi;
        reasons.push("shotCount>=3->multi_shot");
      }
    }
  }

  // Tie-break: cheapest for this duration, then lexical id for total determinism.
  candidates = [...candidates].sort((a, b) => {
    const ca = estimateModelCostUsd(a, brief.durationS);
    const cb = estimateModelCostUsd(b, brief.durationS);
    return ca !== cb ? ca - cb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  reasons.push("cheapest-satisfying");

  const model = candidates[0];
  return { model, reason: reasons.join(","), estimatedUsd: estimateModelCostUsd(model, brief.durationS) };
}

// ---------- provider normalization (sync vs poll vs webhook -> one shape) ----------

export interface ProviderRequest {
  model: ModelEntry;
  // Provider-agnostic params; the ProviderClient maps these onto vendor param names (guidance_scale vs cfg).
  params: Record<string, unknown>;
}

// A submission is either already finished (sync) or a pending handle (poll/webhook). poll() advances a
// pending handle. This collapses all three invocation styles into one loop.
export type Submission =
  | { status: "done"; output: RawProviderOutput }
  | { status: "pending"; handle: string };

export interface RawProviderOutput {
  outputUrl: string;
  contentHash?: string;
  durationS?: number;
  raw?: unknown; // the untouched vendor payload, for debugging/audit
}

export interface ProviderClient {
  submit(req: ProviderRequest): Promise<Submission>;
  poll(handle: string): Promise<Submission>;
}

// The ONE output format every caller sees, regardless of provider or invocation style.
export interface NormalizedOutput {
  provider: string;
  model_id: string;
  modelHandle: string; // our registry id
  outputUrl: string;
  contentHash: string | null;
  durationS: number | null;
  invocation: Invocation;
  cached: boolean;
}

// A cache so identical sub-generations (same model + params) are not paid for twice across retries/chains.
export interface SubGenerationCache {
  get(key: string): NormalizedOutput | undefined;
  set(key: string, value: NormalizedOutput): void;
}

export class InMemorySubGenerationCache implements SubGenerationCache {
  private readonly map = new Map<string, NormalizedOutput>();
  get(key: string): NormalizedOutput | undefined {
    return this.map.get(key);
  }
  set(key: string, value: NormalizedOutput): void {
    this.map.set(key, value);
  }
}

export interface RunModelOptions {
  client: ProviderClient;
  cache?: SubGenerationCache;
  maxPolls?: number; // safety cap on poll loops; default 60
  // Test seam so a poll loop does not actually sleep; defaults to a no-op (polls are driven by the fake).
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

// Run one model through the normalizer: cache hit short-circuits; otherwise submit and, for poll/webhook,
// poll the handle until done (bounded). Returns the single NormalizedOutput shape.
export async function runModel(req: ProviderRequest, opts: RunModelOptions): Promise<NormalizedOutput> {
  const key = cacheKey(req);
  const cache = opts.cache;
  const hit = cache?.get(key);
  if (hit) return { ...hit, cached: true };

  // Default high enough for slow real video jobs (Runway image-to-video runs 60-150s). The fake client
  // finishes in one poll, so this does not slow tests.
  const maxPolls = opts.maxPolls ?? 200;
  const sleep = opts.sleep ?? (async () => undefined);

  let sub = await opts.client.submit(req);
  let polls = 0;
  while (sub.status === "pending") {
    if (polls >= maxPolls) {
      throw new Error(`model ${req.model.id} did not finish within ${maxPolls} polls`);
    }
    if (opts.pollIntervalMs) await sleep(opts.pollIntervalMs);
    sub = await opts.client.poll(sub.handle);
    polls += 1;
  }

  const out: NormalizedOutput = {
    provider: req.model.provider,
    model_id: req.model.model_id,
    modelHandle: req.model.id,
    outputUrl: sub.output.outputUrl,
    contentHash: sub.output.contentHash ?? null,
    durationS: sub.output.durationS ?? null,
    invocation: req.model.invocation,
    cached: false,
  };
  cache?.set(key, out);
  return out;
}

// A stable cache key over the model handle + a canonical encoding of the params.
export function cacheKey(req: ProviderRequest): string {
  return `${req.model.id}:${stableStringify(req.params)}`;
}

// ---------- the default registry (FLAGGED placeholders, re-verify at build time) ----------
// This is CONFIG: edit/extend it to add or swap providers. The ids/prices/versions below are 2026 secondary
// sources and MUST be re-verified before any real spend. The router logic above never hard-codes a model.
export function defaultRegistry(): ModelRegistry {
  return [
    // Video: a cheap preview model and two finals (one multi-shot, one best-physics).
    { id: "preview-video", provider: "fal", model_id: "ltx-video-preview", modality: "video", invocation: "poll", capabilities: ["first_last_frame", "animated"], costPerSecondUsd: 0.01, costPerCallUsd: 0.0, maxDurationS: 15, renderTier: "preview" },
    { id: "runway-multishot", provider: "runway", model_id: "gen4-multishot", modality: "video", invocation: "poll", capabilities: ["multi_shot", "first_last_frame"], costPerSecondUsd: 0.12, costPerCallUsd: 0.0, maxDurationS: 15, renderTier: "final" },
    { id: "kling-physics", provider: "fal", model_id: "kling-2-physics", modality: "video", invocation: "poll", capabilities: ["physics", "first_last_frame"], costPerSecondUsd: 0.2, costPerCallUsd: 0.0, maxDurationS: 10, renderTier: "final" },
    // Image (keyframes/posters): cheap and premium.
    { id: "stability-image", provider: "stability", model_id: "sd3-large", modality: "image", invocation: "sync", capabilities: ["keyframe"], costPerSecondUsd: 0.0, costPerCallUsd: 0.04, maxDurationS: null, renderTier: "both" },
    // Voice + lip-sync (audio stage).
    { id: "elevenlabs-voice", provider: "elevenlabs", model_id: "eleven-multilingual-v2", modality: "voice", invocation: "sync", capabilities: ["dub", "clone"], costPerSecondUsd: 0.006, costPerCallUsd: 0.0, maxDurationS: null, renderTier: "both" },
    { id: "sync-lipsync", provider: "sync", model_id: "lipsync-2", modality: "lipsync", invocation: "poll", capabilities: ["lipsync"], costPerSecondUsd: 0.05, costPerCallUsd: 0.0, maxDurationS: null, renderTier: "both" },
  ];
}

// ---------- fake provider client (tests + dry run) ----------
// Deterministic, zero-cost, no network. Models the three invocation styles: a "sync" model finishes on
// submit; a "poll" model returns pending and finishes after `pollsToFinish` polls; the output url is derived
// only from the request, so the same request is idempotent (and cacheable). Webhook is modeled as poll
// (the real client resolves the handle when the callback arrives).
export class FakeProviderClient implements ProviderClient {
  private readonly handles = new Map<string, { req: ProviderRequest; remaining: number }>();
  private seq = 0;
  constructor(private readonly pollsToFinish = 1) {}

  async submit(req: ProviderRequest): Promise<Submission> {
    if (req.model.invocation === "sync" || this.pollsToFinish <= 0) {
      return { status: "done", output: this.output(req) };
    }
    const handle = `h${++this.seq}`;
    this.handles.set(handle, { req, remaining: this.pollsToFinish });
    return { status: "pending", handle };
  }

  async poll(handle: string): Promise<Submission> {
    const entry = this.handles.get(handle);
    if (!entry) throw new Error(`unknown handle ${handle}`);
    entry.remaining -= 1;
    if (entry.remaining > 0) return { status: "pending", handle };
    this.handles.delete(handle);
    return { status: "done", output: this.output(entry.req) };
  }

  private output(req: ProviderRequest): RawProviderOutput {
    const sig = djb2Hex(`${req.model.id}:${stableStringify(req.params)}`);
    return {
      outputUrl: `https://cdn.example/gen/${req.model.provider}/${sig}.mp4`,
      contentHash: `sha256:${sig}`,
      durationS: typeof req.params.durationS === "number" ? (req.params.durationS as number) : undefined,
    };
  }
}

// ---------- deterministic helpers (no crypto dep, mirrors backends.ts) ----------
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function stableStringify(o: Record<string, unknown>): string {
  const keys = Object.keys(o).sort();
  return keys.map((k) => `${k}=${JSON.stringify(o[k])}`).join(",");
}

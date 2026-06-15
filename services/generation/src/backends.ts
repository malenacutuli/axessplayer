// Media and model backends behind the COST GATE. This is the most important safety boundary in W8.
//
// Real GPU generation and third-party model / media calls (dubbing, TTS, sign avatars, encode, upload)
// cost real money per call. They are a HUMAN STOP GATE. In this package they are NEVER invoked by the
// pipeline directly. Every backend is an injected port. Tests inject a FakeMediaBackend that produces
// deterministic placeholder media at zero cost. A real backend may only run when a human has explicitly
// opened the gate (GENERATION_ALLOW_REAL_SPEND=1) AND wired a real implementation in. The default real
// implementation throws so a misconfigured run fails loud instead of silently spending. No em dashes.

import type { VariantKind, VariantTier } from "./spec.js";

// What a backend is asked to make: one media artifact for one planned variant.
export interface MediaJob {
  kind: VariantKind;
  tier: VariantTier;
  source_url: string;
  language: string;
  intensity: number;
  pov: string | null;
  accessibility: Record<string, unknown>;
  duration_ms: number;
}

// What a backend returns: the produced artifact plus the inputs a C2PA manifest needs to attest it.
export interface MediaArtifact {
  playback_url: string;
  duration_ms: number;
  // A content hash of the produced bytes. Real backends hash the encoded output; the fake backend hashes
  // its deterministic descriptor. The manifest binds to this so a swapped file breaks provenance.
  content_hash: string;
  // The chain of (mocked) processing steps, surfaced for the C2PA manifest assertions.
  steps: string[];
  // The model / tool identifier that produced it (mocked id in tests).
  generator: string;
}

export interface MediaBackend {
  // Whether this backend incurs real cost. The cost gate refuses to run a real backend unless explicitly
  // opened. The fake backend reports false.
  readonly incursRealCost: boolean;
  produce(job: MediaJob): Promise<MediaArtifact>;
}

// ---------- the cost gate ----------
// A thin wrapper every pipeline run goes through. If the chosen backend incurs real cost, the gate must be
// explicitly open or the run aborts before a single paid call. This is the programmatic form of the human
// STOP gate in the brief.
export class CostGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostGateError";
  }
}

export interface CostGateOptions {
  // Mirrors the env var. Defaults to closed. Only a human flips this to true.
  allowRealSpend?: boolean;
}

export function assertCostGate(backend: MediaBackend, opts: CostGateOptions = {}): void {
  const allow =
    opts.allowRealSpend === true || process.env.GENERATION_ALLOW_REAL_SPEND === "1";
  if (backend.incursRealCost && !allow) {
    throw new CostGateError(
      "real-cost media backend blocked by the cost gate. Real GPU / model / media generation is a human STOP gate. " +
        "Set GENERATION_ALLOW_REAL_SPEND=1 only after explicit human sign-off."
    );
  }
}

// ---------- fake backend (tests + dry run) ----------
// Deterministic, zero-cost, no network. Produces a stable placeholder playback_url and a content hash
// derived only from the job, so the same job always yields the same artifact (idempotent dry runs).
export class FakeMediaBackend implements MediaBackend {
  readonly incursRealCost = false;

  async produce(job: MediaJob): Promise<MediaArtifact> {
    const descriptor = [
      job.kind,
      job.tier,
      job.language,
      String(job.intensity),
      job.pov ?? "-",
      stableStringify(job.accessibility),
      job.source_url,
    ].join("|");
    const content_hash = "sha256:" + djb2Hex(descriptor);
    const slug = `${job.kind}.${job.language}.i${job.intensity}${job.pov ? "." + job.pov : ""}`;
    return {
      playback_url: `https://cdn.example/gen/${djb2Hex(job.source_url)}/${slug}.m3u8`,
      duration_ms: job.duration_ms,
      content_hash,
      steps: ["decode", `${job.kind}_synthesize`, "encode_hls"],
      generator: `fake-${job.kind}-v0`,
    };
  }
}

// ---------- default real backend (locked) ----------
// A placeholder that throws. Even with the gate open, a real run must wire in a concrete implementation.
// This exists so the type surface for a real backend is documented and so an accidental real run fails
// loud rather than degrading to a fake.
export class UnimplementedRealMediaBackend implements MediaBackend {
  readonly incursRealCost = true;
  async produce(_job: MediaJob): Promise<MediaArtifact> {
    throw new CostGateError(
      "no real media backend is wired in. Implement MediaBackend against the real GPU / model / media " +
        "vendors and inject it explicitly. This is a human STOP gate."
    );
  }
}

// ---------- small deterministic helpers (no crypto dependency for the fake path) ----------
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

// Poster generation seam. Reuses the Axessible image pipeline (the founder's other repo: stability-ai,
// replicate-ai, google-gemini, generate-thumbnail edge functions) rather than adding a new vendor. The
// endpoint + key are injected via VITE_ env so the founder wires the Axessible Supabase functions URL and
// anon key; until then the generator reports "not configured" and the UI says so (no fake vendor, no fake
// image). The chosen poster is stored on the series with C2PA synthetic provenance (Article 50). No em dashes.

export interface PosterStyle {
  id: string;
  label: string;
  prompt: string;
}

// A small fixed set of styles the author picks from. The prompt is combined with the title + logline.
export const POSTER_STYLES: PosterStyle[] = [
  { id: "cinematic", label: "Cinematic", prompt: "cinematic vertical movie poster, dramatic lighting, high contrast, depth" },
  { id: "noir", label: "Noir", prompt: "film noir vertical poster, moody shadows, restrained palette" },
  { id: "vibrant", label: "Vibrant", prompt: "vibrant editorial vertical poster, bold color blocking, modern" },
  { id: "romance", label: "Romance", prompt: "warm romantic vertical poster, golden hour, soft focus" },
];

export interface PosterCandidate {
  url: string;
}

export interface GeneratePosterInput {
  title: string;
  logline?: string;
  style: PosterStyle;
  count?: number;
}

// Thrown when the Axessible endpoint/key are not configured, so the UI can show an actionable message instead
// of pretending to generate.
export class PosterNotConfiguredError extends Error {
  constructor() {
    super("axessible_poster_not_configured");
    this.name = "PosterNotConfiguredError";
  }
}

export interface PosterConfig {
  endpoint?: string;
  key?: string;
}

export function posterConfig(): PosterConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return {
    endpoint: env.VITE_AXESSIBLE_POSTER_ENDPOINT || undefined,
    key: env.VITE_AXESSIBLE_ANON_KEY || undefined,
  };
}

export function isPosterConfigured(cfg: PosterConfig = posterConfig()): boolean {
  return Boolean(cfg.endpoint);
}

// Provenance recorded with every generated poster: AI-generated, synthetic, C2PA-marked, with the generator
// id, for the Article 50 disclosure posture.
export function posterProvenance(style: PosterStyle): Record<string, unknown> {
  return {
    c2pa: true,
    synthetic: true,
    generator: "axessible-image-pipeline",
    style: style.id,
  };
}

// Pull candidate image URLs out of whatever shape the Axessible edge function returns. Tolerant of the common
// shapes (data[].url, images[].url, output[], url) so the founder's chosen function (stability-ai,
// generate-thumbnail, replicate-ai) can be wired without a code change.
export function parseCandidates(payload: unknown): PosterCandidate[] {
  const urls: string[] = [];
  const pushUrl = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) urls.push(v);
    else if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") urls.push((v as { url: string }).url);
  };
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  for (const key of ["data", "images", "output", "candidates", "results"]) {
    const arr = p[key];
    if (Array.isArray(arr)) arr.forEach(pushUrl);
  }
  pushUrl(p.url);
  pushUrl(p.image);
  return [...new Set(urls)].map((url) => ({ url }));
}

// Generate poster candidates from the Axessible image pipeline. Throws PosterNotConfiguredError when the
// endpoint is unset. The request body is a generic { title, logline, prompt, n } shape; adapt to the exact
// edge function on wiring.
export async function generatePoster(
  input: GeneratePosterInput,
  opts: { config?: PosterConfig; fetch?: typeof globalThis.fetch } = {},
): Promise<PosterCandidate[]> {
  const cfg = opts.config ?? posterConfig();
  if (!cfg.endpoint) throw new PosterNotConfiguredError();
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const prompt = `${input.title}. ${input.logline ?? ""} ${input.style.prompt}`.trim();
  const res = await doFetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.key ? { authorization: `Bearer ${cfg.key}`, apikey: cfg.key } : {}),
    },
    body: JSON.stringify({ title: input.title, logline: input.logline, prompt, n: input.count ?? 2, aspect: "9:16" }),
  });
  if (!res.ok) throw new Error(`poster generation failed (${res.status})`);
  const payload = (await res.json().catch(() => ({}))) as unknown;
  const candidates = parseCandidates(payload);
  if (candidates.length === 0) throw new Error("poster generation returned no images");
  return candidates;
}

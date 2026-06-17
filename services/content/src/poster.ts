// Server-side poster generation. Calls the project's stability-ai edge function, uploads the returned PNG
// to a public storage bucket, and returns the public URL. This runs SERVER-SIDE so no generation key or
// service-role token ever reaches the browser: the Studio posts a prompt, the content service generates,
// stores, and persists series.poster_url with C2PA + Article 50 provenance. No em dashes.

export interface PosterGenConfig {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string; // a public bucket so the poster URL is directly renderable
  fetch?: typeof globalThis.fetch;
  now?: () => number; // injectable for deterministic paths in tests
}

export interface PosterGenInput {
  seriesId: string;
  prompt: string;
}

export interface PosterGenerator {
  generate(input: PosterGenInput): Promise<{ url: string }>;
}

// Build a generator bound to the hosted Supabase project. Returns undefined when the env is not configured
// so the route can answer 501 instead of pretending. No em dashes.
export function makePosterGenerator(cfg: PosterGenConfig | undefined): PosterGenerator | undefined {
  if (!cfg || !cfg.supabaseUrl || !cfg.serviceKey || !cfg.bucket) return undefined;
  const f = cfg.fetch ?? globalThis.fetch.bind(globalThis);
  const now = cfg.now ?? (() => Date.now());
  return {
    async generate(input: PosterGenInput): Promise<{ url: string }> {
      // 1. Generate the image (stability-ai returns raw image bytes).
      const gen = await f(`${cfg.supabaseUrl}/functions/v1/stability-ai`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.serviceKey}`,
          apikey: cfg.serviceKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: input.prompt, style_preset: "photographic", aspect_ratio: "9:16", output_format: "png" }),
      });
      if (!gen.ok) {
        const detail = await gen.text().catch(() => "");
        throw new Error(`stability-ai ${gen.status}: ${detail.slice(0, 160)}`);
      }
      const bytes = new Uint8Array(await gen.arrayBuffer());

      // 2. Upload to the public bucket (upsert so a retry overwrites rather than 409s).
      const path = `posters/${input.seriesId}-${now()}.png`;
      const up = await f(`${cfg.supabaseUrl}/storage/v1/object/${cfg.bucket}/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.serviceKey}`,
          apikey: cfg.serviceKey,
          "content-type": "image/png",
          "x-upsert": "true",
        },
        body: bytes,
      });
      if (!up.ok) {
        const detail = await up.text().catch(() => "");
        throw new Error(`storage upload ${up.status}: ${detail.slice(0, 160)}`);
      }

      // 3. The public object URL.
      return { url: `${cfg.supabaseUrl}/storage/v1/object/public/${cfg.bucket}/${path}` };
    },
  };
}

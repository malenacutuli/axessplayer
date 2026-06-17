// Runtime configuration. Every service base url is injected through a VITE_ env var so one build can
// point at the Prism mocks, staging, or production. Defaults target a single localhost Prism gateway
// (the mock environment runs all four specs behind one origin). No em dashes.

export interface AppConfig {
  contentBaseUrl: string;
  economyBaseUrl: string;
  decisionBaseUrl: string;
  manifestBaseUrl: string;
}

// import.meta.env is typed by vite/client; we read defensively so tests and SSR-less builds work.
type EnvBag = Record<string, string | undefined>;

function readEnv(): EnvBag {
  // In Vite, import.meta.env carries the VITE_ vars. In a bare test runtime it may be undefined.
  const metaEnv = (import.meta as unknown as { env?: EnvBag }).env;
  return metaEnv ?? {};
}

const DEFAULT_GATEWAY = "http://localhost:4010";

export function loadConfig(env: EnvBag = readEnv()): AppConfig {
  return {
    contentBaseUrl: env.VITE_CONTENT_BASE_URL ?? DEFAULT_GATEWAY,
    economyBaseUrl: env.VITE_ECONOMY_BASE_URL ?? DEFAULT_GATEWAY,
    decisionBaseUrl: env.VITE_DECISION_BASE_URL ?? DEFAULT_GATEWAY,
    manifestBaseUrl: env.VITE_MANIFEST_BASE_URL ?? DEFAULT_GATEWAY,
  };
}

// Optional real video clip for the player poster surface. When VITE_SCENE_VIDEO_URL is set, the player
// renders a muted autoplaying looping <video> as the full-bleed surface (captions/overlay on top),
// seeked per cut, so a provided clip plays through the cuts. When unset, the gradient poster is used.
export function sceneVideoUrl(env: EnvBag = readEnv()): string | undefined {
  const u = env.VITE_SCENE_VIDEO_URL;
  return u && u.trim() ? u : undefined;
}

export interface SceneA11y {
  caption_doc_url: string;
  audio_description_url: string;
  sign_video_url: string;
  dub_audio_urls: Record<string, string>;
  language: string;
}

// Matched accessibility tracks for the scene-video fallback. When a cut's own media is unreachable and the
// player shows the scene clip instead, these tracks (shipped in the same directory as the scene clip, the
// mqfkdb5y bundle: captions.json, ad.json, asl_sign.webm, <lang>_dub.m4a) provide the CWI / AD / sign / dub
// layer so accessibility still works and stays synced to the scene clip. Derived by convention from the
// scene URL's directory. No em dashes.
export function sceneA11y(env: EnvBag = readEnv()): SceneA11y | undefined {
  const u = sceneVideoUrl(env);
  if (!u) return undefined;
  const dir = u.split("?")[0].replace(/\/[^/]+$/, "");
  const langs = ["de", "es", "fr", "it", "pt"];
  return {
    caption_doc_url: `${dir}/captions.json`,
    audio_description_url: `${dir}/ad.json`,
    sign_video_url: `${dir}/asl_sign.webm`,
    dub_audio_urls: Object.fromEntries(langs.map((l) => [l, `${dir}/${l}_dub.m4a`])),
    language: "en",
  };
}

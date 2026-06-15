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

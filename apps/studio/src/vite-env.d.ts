/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTENT_BASE_URL?: string;
  readonly VITE_CATALOG_BASE_URL?: string;
  readonly VITE_CREATOR_SESSION_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

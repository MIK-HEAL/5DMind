/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKSPACE_MODE?: "local" | "remote";
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

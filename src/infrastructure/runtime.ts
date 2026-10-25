export type RuntimeTarget = "web" | "desktop" | "mobile";
export type WorkspaceMode = "local" | "remote";

const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMobileUserAgent = typeof navigator !== "undefined" && (
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
);

export const runtimeTarget: RuntimeTarget = !isTauriRuntime
  ? "web"
  : isMobileUserAgent
    ? "mobile"
    : "desktop";
export const isNativeRuntime = runtimeTarget !== "web";

const configuredMode = import.meta.env.VITE_WORKSPACE_MODE;

export const workspaceMode: WorkspaceMode = configuredMode === "remote" ? "remote" : "local";
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:3000";

export const runtimeConfig = {
  target: runtimeTarget,
  workspaceMode,
  apiBaseUrl,
} as const;

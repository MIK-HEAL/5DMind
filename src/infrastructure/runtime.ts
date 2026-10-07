export type RuntimeTarget = "web" | "desktop";
export type WorkspaceMode = "local" | "remote";

export const runtimeTarget: RuntimeTarget =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "desktop" : "web";

const configuredMode = import.meta.env.VITE_WORKSPACE_MODE;

export const workspaceMode: WorkspaceMode = configuredMode === "remote" ? "remote" : "local";
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:3000";

export const runtimeConfig = {
  target: runtimeTarget,
  workspaceMode,
  apiBaseUrl,
} as const;

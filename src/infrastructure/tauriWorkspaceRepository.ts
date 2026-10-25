import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceSnapshot } from "../domain/types";
import { createEmptyWorkspace } from "./workspaceFactory";

// Native persistence is backed by Tauri SQLite on desktop and mobile. A missing
// row means a new empty workspace, not a demo fixture.

export const tauriWorkspaceRepository = {
  async load(): Promise<WorkspaceSnapshot> {
    const snapshot = await invoke<WorkspaceSnapshot | null>("load_workspace");
    return snapshot?.version === 1 ? snapshot : createEmptyWorkspace();
  },

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    await invoke("save_workspace", { snapshot });
  },

  async reset(): Promise<WorkspaceSnapshot> {
    await invoke("reset_workspace");
    return createEmptyWorkspace();
  },
};

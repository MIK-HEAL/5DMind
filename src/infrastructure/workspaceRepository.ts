import type { WorkspaceSnapshot } from "../domain/types";
import { createEmptyWorkspace } from "./workspaceFactory";

// Web-only local repository. Desktop runtime uses tauriWorkspaceRepository.

const DB_NAME = "5dmind-workspace";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "active";
const LOCAL_KEY = "5dmind.workspace.v1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDb(): Promise<WorkspaceSnapshot | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
    request.onsuccess = () => resolve(request.result as WorkspaceSnapshot | undefined);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function writeIndexedDb(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export const workspaceRepository = {
  async load(): Promise<WorkspaceSnapshot> {
    try {
      const stored = await readIndexedDb();
      if (stored?.version === 1) return stored;
    } catch {
      const fallback = localStorage.getItem(LOCAL_KEY);
      if (fallback) {
        const snapshot = JSON.parse(fallback) as WorkspaceSnapshot;
        if (snapshot.version === 1) return snapshot;
      }
    }
    return createEmptyWorkspace();
  },

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    try {
      await writeIndexedDb(snapshot);
    } catch {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
    }
  },

  async reset(): Promise<WorkspaceSnapshot> {
    const snapshot = createEmptyWorkspace();
    await this.save(snapshot);
    return snapshot;
  },
};

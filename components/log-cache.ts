// The trip's sealed rows, kept on this phone between visits so a page open fetches only what
// landed since. Ciphertext only — worthless without the keyring — and append-only, like the log:
// a row never changes, so nothing here is ever invalidated, only added to.

import type { EventRow } from "@/lib/db/schema";

const DB_NAME = "souvenir-log";
const STORE = "rows";

let db: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no storage"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: ["tripId", "seq"] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("storage refused"));
    req.onblocked = () => reject(new Error("storage blocked"));
  });
  return db;
}

export async function loadRows(tripId: string): Promise<EventRow[]> {
  try {
    const store = (await openDb()).transaction(STORE, "readonly").objectStore(STORE);
    const range = IDBKeyRange.bound([tripId, 0], [tripId, Number.MAX_SAFE_INTEGER]);
    return await new Promise((resolve, reject) => {
      const req = store.getAll(range);
      req.onsuccess = () => resolve(req.result as EventRow[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Best effort: without storage the next visit fetches the whole log. */
export async function saveRows(rows: readonly EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const tx = (await openDb()).transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const row of rows) store.put(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Nothing kept; nothing lost.
  }
}

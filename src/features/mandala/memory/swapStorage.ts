/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier L3 — Async IndexedDB Cold Swap & Session Durability Port (DIP).
 * Avoids 5MB localStorage bottlenecks & main-thread JSON.stringify stalls on heavy scenes
 * by swapping cold wedge batches and session snapshots cleanly to IndexedDB (`mandala_studio_swap_v1`).
 */

import { Result, ok, err } from '../../../shared/lib/result.ts';
import { IDB_SWAP_CONFIG } from '../model/constants.ts';
import { parseMandalaDocument } from '../model/schemas.ts';
import type { MandalaDocument, WedgeStroke } from '../model/types.ts';

export interface ColdSwapBatch {
  readonly batchId: string;
  readonly wedges: readonly WedgeStroke[];
  readonly savedAt: string;
}

export interface SwapStoragePort {
  saveActiveDocument(doc: MandalaDocument): Promise<Result<void, string>>;
  loadActiveDocument(): Promise<Result<MandalaDocument | null, string>>;
  clearActiveDocument(): Promise<Result<void, string>>;
  swapOutColdBatch(batchId: string, wedges: readonly WedgeStroke[]): Promise<Result<void, string>>;
  restoreColdBatch(batchId: string): Promise<Result<ColdSwapBatch | null, string>>;
  purgeColdBatch(batchId: string): Promise<Result<void, string>>;
  clearAllColdBatches(): Promise<Result<number, string>>;
}

/**
 * Context Manager scoping an IndexedDB database connection with deterministic `.close()` cleanup.
 */
async function withIndexedDb<T>(
  work: (db: IDBDatabase) => Promise<T>
): Promise<Result<T, string>> {
  if (typeof indexedDB === 'undefined') {
    return err('IndexedDB non disponibile in questo ambiente.');
  }

  let db: IDBDatabase | null = null;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(IDB_SWAP_CONFIG.dbName, IDB_SWAP_CONFIG.dbVersion);
      request.onupgradeneeded = () => {
        const target = request.result;
        if (!target.objectStoreNames.contains(IDB_SWAP_CONFIG.documentStore)) {
          target.createObjectStore(IDB_SWAP_CONFIG.documentStore);
        }
        if (!target.objectStoreNames.contains(IDB_SWAP_CONFIG.coldWedgeStore)) {
          target.createObjectStore(IDB_SWAP_CONFIG.coldWedgeStore);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Apertura database IndexedDB fallita.'));
    });

    const out = await work(db);
    return ok(out);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Errore IndexedDB sconosciuto.');
  } finally {
    db?.close();
  }
}

function runIdbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Operazione IndexedDB fallita.'));
  });
}

export const IndexedDbSwapAdapter: SwapStoragePort = {
  async saveActiveDocument(doc) {
    return withIndexedDb(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.documentStore, 'readwrite');
      const store = tx.objectStore(IDB_SWAP_CONFIG.documentStore);
      await runIdbRequest(store.put(doc, IDB_SWAP_CONFIG.activeDocKey));
    });
  },

  async loadActiveDocument() {
    const rawRes = await withIndexedDb<unknown>(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.documentStore, 'readonly');
      const store = tx.objectStore(IDB_SWAP_CONFIG.documentStore);
      return runIdbRequest(store.get(IDB_SWAP_CONFIG.activeDocKey));
    });
    if (!rawRes.ok) return err(rawRes.error);
    if (rawRes.value === undefined || rawRes.value === null) return ok(null);
    return parseMandalaDocument(rawRes.value);
  },

  async clearActiveDocument() {
    return withIndexedDb(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.documentStore, 'readwrite');
      const store = tx.objectStore(IDB_SWAP_CONFIG.documentStore);
      await runIdbRequest(store.delete(IDB_SWAP_CONFIG.activeDocKey));
    });
  },

  async swapOutColdBatch(batchId, wedges) {
    return withIndexedDb(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.coldWedgeStore, 'readwrite');
      const store = tx.objectStore(IDB_SWAP_CONFIG.coldWedgeStore);
      const batch: ColdSwapBatch = {
        batchId,
        wedges,
        savedAt: new Date().toISOString(),
      };
      await runIdbRequest(store.put(batch, batchId));
    });
  },

  async restoreColdBatch(batchId) {
    return withIndexedDb<ColdSwapBatch | null>(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.coldWedgeStore, 'readonly');
      const store = tx.objectStore(IDB_SWAP_CONFIG.coldWedgeStore);
      const result: unknown = await runIdbRequest(store.get(batchId));
      if (!result || typeof result !== 'object') return null;
      const candidate = result as Partial<ColdSwapBatch>;
      if (typeof candidate.batchId !== 'string' || !Array.isArray(candidate.wedges)) {
        return null;
      }
      return {
        batchId: candidate.batchId,
        wedges: candidate.wedges,
        savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : '',
      };
    });
  },

  async purgeColdBatch(batchId) {
    return withIndexedDb(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.coldWedgeStore, 'readwrite');
      const store = tx.objectStore(IDB_SWAP_CONFIG.coldWedgeStore);
      await runIdbRequest(store.delete(batchId));
    });
  },

  async clearAllColdBatches() {
    return withIndexedDb(async (db) => {
      const tx = db.transaction(IDB_SWAP_CONFIG.coldWedgeStore, 'readwrite');
      const store = tx.objectStore(IDB_SWAP_CONFIG.coldWedgeStore);
      const count = await runIdbRequest(store.count());
      await runIdbRequest(store.clear());
      return count;
    });
  },
};

/**
 * Deterministic In-Memory Swap Adapter for Node/unit tests & SSR environments.
 */
export function createInMemorySwapAdapter(): SwapStoragePort {
  let activeDoc: MandalaDocument | null = null;
  const coldMap = new Map<string, ColdSwapBatch>();

  return {
    async saveActiveDocument(doc) {
      activeDoc = doc;
      return ok(undefined);
    },
    async loadActiveDocument() {
      if (!activeDoc) return ok(null);
      return parseMandalaDocument(activeDoc);
    },
    async clearActiveDocument() {
      activeDoc = null;
      return ok(undefined);
    },
    async swapOutColdBatch(batchId, wedges) {
      coldMap.set(batchId, {
        batchId,
        wedges: [...wedges],
        savedAt: new Date().toISOString(),
      });
      return ok(undefined);
    },
    async restoreColdBatch(batchId) {
      return ok(coldMap.get(batchId) ?? null);
    },
    async purgeColdBatch(batchId) {
      coldMap.delete(batchId);
      return ok(undefined);
    },
    async clearAllColdBatches() {
      const count = coldMap.size;
      coldMap.clear();
      return ok(count);
    },
  };
}

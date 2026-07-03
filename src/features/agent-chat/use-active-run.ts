import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { makeClient } from '@/lib/agent/client';
import { getSettings } from '@/lib/settings/store';

/** Storage shape `useStream`'s `reconnectOnMount` expects. */
export type RunMetadataStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function memoryStorage(seed?: Record<string, string>): RunMetadataStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const EMPTY_STORAGE = memoryStorage();

/** The latest still-active run on a thread, if any. */
export async function fetchActiveRunId(threadId: string): Promise<string | null> {
  const client = makeClient(getSettings());
  const runs = await client.runs.list(threadId, { limit: 5 });
  const active = runs.find((r) => r.status === 'pending' || r.status === 'running');
  return active?.run_id ?? null;
}

/**
 * Attach-to-running: `useStream({ reconnectOnMount })` rejoins the run whose id
 * it finds under `lg:stream:<threadId>` in the given storage. We pre-seed an
 * in-memory storage with the thread's active run id (from `runs.list`), so
 * opening a *running* thread — from the Calls tab, another device, or after a
 * refresh — attaches to the live stream instead of showing a stale snapshot.
 *
 * Returns `undefined` while resolving (gate the stream mount on it), then a
 * storage object (possibly empty when nothing is running).
 */
export function useAttachStorage(threadId: string | undefined) {
  // Per-mount nonce → every screen open resolves the active run fresh, while
  // the resolved storage stays stable for the mounted screen (flipping back to
  // undefined would remount the stream mid-hydration).
  const [nonce] = useState(() => Math.random().toString(36).slice(2));
  const query = useQuery({
    queryKey: ['active-run', threadId, nonce],
    queryFn: async () => {
      const runId = await fetchActiveRunId(threadId as string);
      return memoryStorage(runId ? { [`lg:stream:${threadId}`]: runId } : undefined);
    },
    enabled: !!threadId,
    staleTime: Infinity,
    retry: 1,
  });
  // No thread yet (fresh run page) → nothing to attach to; mount immediately.
  if (!threadId) return EMPTY_STORAGE;
  // On error, fall back to an empty storage rather than blocking the screen.
  if (query.isError) return EMPTY_STORAGE;
  return query.data; // undefined while loading → caller shows a spinner
}

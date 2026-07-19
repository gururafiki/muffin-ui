/**
 * Bridge from the platform `KeyValueStore` to zustand's `persist` middleware.
 *
 * Two jobs beyond plain adaptation:
 *  - **Legacy-payload adoption.** The stores predate the middleware and wrote
 *    bare state JSON under the same keys. On read, a payload without the
 *    persist envelope is wrapped as `{ state, version: 0 }`, so existing
 *    users' settings/portfolios flow through `migrate` instead of being lost.
 *  - **Debounced writes** (opt-in). The settings screen persists per
 *    keystroke; a trailing debounce batches that into one serialize + write.
 *    Pending writes are flushed on web `beforeunload`.
 */
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

import { storage } from '@/lib/storage';

export function persistStorage(opts?: { debounceMs?: number }) {
  const debounceMs = opts?.debounceMs ?? 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();

  const flush = (name: string) => {
    const value = pending.get(name);
    if (value == null) return;
    pending.delete(name);
    clearTimeout(timers.get(name));
    timers.delete(name);
    storage.set(name, value);
  };

  if (debounceMs > 0 && typeof window !== 'undefined' && 'addEventListener' in window) {
    window.addEventListener('beforeunload', () => {
      for (const name of [...pending.keys()]) flush(name);
    });
  }

  const stateStorage: StateStorage = {
    getItem: (name) => {
      const raw = pending.get(name) ?? storage.getString(name);
      if (raw == null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'state' in parsed) return raw;
        // Pre-middleware bare payload → wrap as version 0 for `migrate`.
        return JSON.stringify({ state: parsed, version: 0 });
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (debounceMs <= 0) {
        storage.set(name, value);
        return;
      }
      pending.set(name, value);
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => flush(name), debounceMs));
    },
    removeItem: (name) => {
      pending.delete(name);
      clearTimeout(timers.get(name));
      timers.delete(name);
      storage.delete(name);
    },
  };

  return createJSONStorage(() => stateStorage);
}

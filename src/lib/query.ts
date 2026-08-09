import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { AppState, Platform } from 'react-native';

import { storage } from '@/lib/storage';

/** Shared TanStack Query client for server/agent state (assistant lists, etc.). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

// On native, drive TanStack's focus from AppState so interval refetches pause
// while the app is backgrounded — the default `refetchIntervalInBackground:
// false` only helps if focus is actually wired.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
}

/**
 * Persist the query cache across app launches.
 *
 * Market reference data (sectors, classifications, performance) is identical for
 * every user and changes slowly, so re-fetching it on every cold start is pure
 * latency — most visibly on mobile, where a launch on a bad connection otherwise
 * shows the bundled sample numbers until the network answers.
 *
 * Rides the SAME `KeyValueStore` the settings/wealth stores use (MMKV on native,
 * localStorage on web), so there is no second persistence mechanism to reason about.
 * `createSyncStoragePersister` wants a `Storage`-shaped object, hence the adapter.
 *
 * ONLY `market` queries are persisted. Agent state (threads, run history, presets)
 * is per-user and auth-scoped: persisting it would leak one account's runs into the
 * next session on a shared device and serve stale run status on launch.
 */
const persister = createSyncStoragePersister({
  key: 'muffin.query.v1',
  storage: {
    getItem: (key: string) => storage.getString(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

void persistQueryClient({
  queryClient,
  persister,
  // Drop anything older than a day on restore; `stale_after` on the rows themselves
  // is what drives an actual refresh.
  maxAge: 24 * 60 * 60_000,
  // Bump when a persisted query's SHAPE changes — it discards the old cache instead
  // of rehydrating rows the new code cannot read.
  buster: 'market-v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && query.queryKey[0] === 'market',
  },
});

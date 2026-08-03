import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

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

/**
 * Ask the server to refresh the data behind THIS page.
 *
 * ADMIN ONLY, and shown only to admins — `market-refresh` rejects a non-admin token, so a button
 * everyone can see would be a button that fails for almost everyone. The check here decides what
 * the UI OFFERS; the server checks the same claim on the verified token and is the actual
 * permission. A client-side boolean is a convenience, never a gate.
 *
 * Refreshing is normally automatic (a cron warm-up, plus stale-while-revalidate when a reader
 * touches a stale row). This exists for the case those do not cover: data that is fresh by the
 * TTL's reckoning and WRONG — a provider correction, or a fund whose holdings were just re-filed.
 *
 * It deliberately does NOT pass `force`: that needs the service-role key, and bypassing the TTL
 * from a button is how a provider's rate limit gets hit by someone clicking twice.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { triggerRefresh } from './api/market-client';

export function RefreshButton({
  resources,
  /** Query keys to invalidate once the server reports success. */
  invalidate = [],
  label = 'Refresh',
}: {
  resources: string[];
  invalidate?: readonly (readonly unknown[])[];
  label?: string;
}) {
  const isAdmin = useAuth((s) => s.session?.isAdmin ?? false);
  const queryClient = useQueryClient();

  const refresh = useMutation({
    // Sequential, not Promise.all: these hit the same upstream providers, and firing every
    // resource for a page at once is exactly the burst that made SEC throttle a fund ingest.
    mutationFn: async () => {
      const failed: string[] = [];
      for (const r of resources) {
        try {
          await triggerRefresh(r);
        } catch (e) {
          failed.push(`${r}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (failed.length === resources.length) throw new Error(failed.join(' | '));
      return failed;
    },
    onSuccess: () => {
      for (const key of invalidate) queryClient.invalidateQueries({ queryKey: key });
    },
    // A refresh failing must not blank the page: the existing data is still the best available.
    onError: (e) => console.warn(`[market] refresh failed, keeping existing data: ${String(e)}`),
  });

  if (!isAdmin) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={refresh.isPending}
      onPress={() => refresh.mutate()}
      className="flex-row items-center gap-1.5 rounded-crumb px-2 py-1 active:opacity-70">
      <Icon
        name="refresh"
        size={16}
        color={refresh.isPending ? palette.frosting[300] : palette.frosting[600]}
      />
      <Text variant="muted" className="text-xs">
        {refresh.isPending ? 'refreshing…' : label}
      </Text>
    </Pressable>
  );
}

/** The resources behind each screen, so a page names what it refreshes in one place. */
export const PAGE_RESOURCES = {
  globe: ['country-performance', 'group-performance'],
  markets: ['sector-performance', 'instrument-performance', 'instrument-profile'],
  sector: ['sector-performance', 'security-performance'],
  country: ['country-performance', 'sector-performance'],
  group: ['group-performance', 'country-performance'],
  stock: ['instrument-performance', 'instrument-prices', 'instrument-profile'],
} as const;

/** Empty view used where a page has no admin — keeps the header row's layout stable. */
export const RefreshSlot = ({ children }: { children: React.ReactNode }) => (
  <View className="flex-row items-center gap-2">{children}</View>
);

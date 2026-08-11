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
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { triggerRefresh } from './api/market-client';

/**
 * What each resource actually syncs, and from where.
 *
 * A refresh button that does not say what it refreshes asks for blind trust: the reader cannot
 * tell whether it will re-read a filing, re-price a universe, or spend someone's provider quota.
 * Keyed per RESOURCE rather than per page, so the two cannot drift apart.
 */
export const RESOURCE_INFO: Record<string, string> = {
  'sector-performance': 'US sector returns — finviz (US-listed only)',
  'country-performance': 'Each country ETF\u2019s returns — yfinance',
  'group-performance': 'Each tier\u2019s proxy-ETF returns — yfinance',
  'instrument-performance': 'Returns for the 35 curated instruments — yfinance',
  'instrument-profile': 'Sector, industry and market cap for those instruments — yfinance',
  'instrument-prices': '~400 days of prices for them — yfinance',
  'security-performance': 'Returns for every security with a symbol — yfinance',
  'security-profiles': 'Sector for securities that lack one — yfinance',
  'security-industries': 'Sub-sector (industry) and market cap — yfinance',
  'security-fundamentals': 'P/E, margins, ROE and the rest — yfinance',
  'security-tickers': 'US tickers for unresolved ISINs — OpenFIGI',
  'security-local-symbols': 'Local exchange symbols (005930.KS) — OpenFIGI',
  'fund-holdings': 'ETF holdings from their latest filings — SEC N-PORT',
  'derive-classifications': 'Sector and country membership — computed from holdings, no provider',
  'exchange-listings': 'Every listed company on one exchange — OpenFIGI',
  'security-refresh': 'This stock\u2019s returns, market cap and fundamentals — yfinance',
};

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
  const [showInfo, setShowInfo] = useState(false);

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
    <View className="items-end">
      <View className="flex-row items-center gap-1">
        {/* An `i` you can TAP, not a tooltip: RN has no hover, so an explanation that only appears
            on hover would never appear at all on the platform this mostly runs on. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What does refresh do?"
          onPress={() => setShowInfo((v) => !v)}
          className="h-5 w-5 items-center justify-center rounded-full border border-frosting-300 active:opacity-70">
          <Text variant="muted" className="text-[10px]">i</Text>
        </Pressable>

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
      </View>

      {/* One line per resource, naming the data AND the provider — the two things a reader cannot
          infer from the word "refresh". Collapsed by default: it explains the button, it is not
          the button. */}
      {showInfo ? (
        <View className="mt-1 max-w-xs gap-0.5 rounded-crumb bg-frosting-50 p-2 dark:bg-night-surface-muted">
          {resources.map((r) => (
            <Text key={r} variant="muted" className="text-[11px]">
              • {RESOURCE_INFO[r] ?? r}
            </Text>
          ))}
          <Text variant="muted" className="text-[10px] opacity-70">
            Skipped if the data is still inside its refresh window.
          </Text>
        </View>
      ) : null}
    </View>
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

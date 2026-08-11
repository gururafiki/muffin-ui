import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { useState } from 'react';

import { Icon } from '@/components/icons';
import { Button, Card, Chip, Screen, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { Breadcrumb, type Crumb } from '@/features/markets/breadcrumb';
import { DrillList } from '@/features/markets/drill-list';
import { MoversPanel } from '@/features/markets/movers-panel';
import { SECTOR_PERIODS } from '@/features/markets/api/periods';
import {
  SECTOR_PAGE_SIZE,
  useSectorConstituents,
} from '@/features/markets/api/use-sector-constituents';
import { Freshness } from '@/features/markets/freshness';
import { useCountry } from '@/features/markets/api/use-countries';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { PAGE_RESOURCES, RefreshButton } from '@/features/markets/refresh-button';
import { analyseSector, getRegion, getSector } from '@/features/markets/taxonomy';

export default function SectorScreen() {
  const params = useLocalSearchParams<{ sectorId: string; countryId?: string }>();
  const router = useRouter();
  const sector = getSector(params.sectorId);
  // Same deep-link hazard as the country page: the list is server-side.
  const { country } = useCountry(params.countryId);
  const region = country ? getRegion(country.regionId) : undefined;

  // Hooks run before the early return below — `sector` can be undefined.
  const period = useActivePeriod(SECTOR_PERIODS);
  const [limit, setLimit] = useState(SECTOR_PAGE_SIZE);
  // Drilling in from a country page means "this sector IN this country".
  const constituents = useSectorConstituents(params.sectorId ?? '', period, {
    countryIso2: country?.iso,
    limit,
  });

  // Rows are keyed by `security_id` (a holding with no US listing has no ticker, and several such
  // rows would collide on an empty key), so the tap has to resolve the symbol back. A security
  // whose ticker OpenFIGI has not resolved has no stock page to open — so the tap does nothing
  // rather than routing to /stock/undefined.
  // Grow the page as the reader nears the bottom. Guarded on `loadingMore` because the scroll
  // handler fires continuously: without it one flick would queue several pages at once.
  const loadMore = () => {
    if (!constituents.hasMore || constituents.loadingMore) return;
    setLimit((n) => n + SECTOR_PAGE_SIZE);
  };

  const goStock = (key: string) => {
    const ticker = stocks.find((s) => s.id === key)?.symbol;
    if (!ticker) return;
    goTicker(ticker);
  };

  const goTicker = (ticker: string) =>
    router.push({
      pathname: '/stock/[ticker]',
      params: {
        ticker,
        sector: sector?.id ?? '',
        market: country?.market ?? '',
        country: country?.name ?? '',
      },
    });

  if (!sector) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown sector</Text>
        </Card>
      </Screen>
    );
  }

  const crumbs: Crumb[] = [{ label: 'Globe', href: '/' }];
  if (region) crumbs.push({ label: region.name, href: { pathname: '/region/[regionId]', params: { regionId: region.id } } });
  if (country) crumbs.push({ label: country.name, href: { pathname: '/country/[countryId]', params: { countryId: country.id } } });
  crumbs.push({ label: sector.name });

  const stocks = constituents.items;
  const contextName = country ? `${sector.name} · ${country.name}` : sector.name;
  // Real industries from the provider when we have them; the authored slugs
  // (which had nothing behind them) only as the pre-server fallback.
  // Still NO fallback to `sector.subSectors` — those are authored slugs with nothing behind them.
  // The chips are live sub-sectors or nothing.
  const subSectors = constituents.subSectors;
  const movers = stocks
    .filter((s) => s.changePct !== null)
    // No `sublabel`: MoversPanel PREFIXES it before the label (it is meant for a
    // flag emoji), so a country name there reads "United States AAPL · Apple Inc.".
    // The list below already carries industry · country.
    .map((s) => ({ key: s.id, label: s.symbol ? `${s.symbol} · ${s.name}` : s.name, changePct: s.changePct as number }));

  return (
    <Screen onEndReached={loadMore}>
      <Stack.Screen options={{ title: sector.name }} />
      <Breadcrumb crumbs={crumbs} />

      <Card tone="sticker" className="mt-1 gap-3">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
            <Icon name={sector.icon} size={28} color={palette.frosting[600]} />
          </View>
          <Text variant="title" className="flex-1">
            {sector.name}
          </Text>
        </View>
        {subSectors.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {subSectors.map((s) => (
            // Only de-hyphenate authored SLUGS ('software-saas'). A real provider
            // industry ('Software - Application') already has spaces, and the same
            // replace turned its separator into a double space.
            <Chip key={s} label={s.includes(' ') ? s : s.replace(/-/g, ' ')} />
          ))}
        </View>
        ) : null}
      </Card>

      <View className="mt-4">
        <MoversPanel
          title="Stock performance"
          items={movers}
          onSelect={goStock}
          count={4}
          sample={constituents.sample}
          asOf={constituents.asOf}
          source={constituents.source}
          refreshing={constituents.refreshing}
          right={<PeriodPicker periods={SECTOR_PERIODS} />}
        />
      </View>

      <View className="mt-4">
        <AnalyseButton title="Analyse sector performance" query={analyseSector(sector.name, country?.name)} />
      </View>

      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Stocks</Text>
        <View className="flex-row items-center gap-2">
          <Freshness
            sample={constituents.sample}
            asOf={constituents.asOf}
            source={constituents.source}
            refreshing={constituents.refreshing}
          />
          <RefreshButton
            resources={[...PAGE_RESOURCES.sector]}
            invalidate={[['market', 'sector-constituents'], ['market', 'performance', 'instrument']]}
          />
        </View>
      </View>
      <View className="mt-2">
        <DrillList
          items={stocks.map((s) => ({
            // `security_id`, not the symbol: a holding with no US listing has no ticker at all,
            // and several such rows would collide on an empty key.
            key: s.id,
            title: s.symbol ? `${s.symbol} · ${s.name}` : s.name,
            // Weight in the sector fund is the honest size signal here — it comes from the fund's
            // own filing, where market cap would need a paid provider.
            // Sub-sector first: it is the most specific thing known about the company.
            subtitle: [s.industry, s.country, s.weight != null ? `${s.weight.toFixed(2)}% of fund` : null]
              .filter(Boolean)
              .join(' · '),
            changePct: s.changePct ?? undefined,
            disabled: !s.symbol,
          }))}
          onSelect={goStock}
        />
      </View>

      {/* Infinite scroll grows the page automatically (see `loadMore`); this stays as the
          explicit affordance for anyone who does not scroll — a keyboard or screen-reader user
          has no scroll gesture to trigger it, and "the list just ends" is indistinguishable from
          "that is all there is". */}
      {constituents.hasMore ? (
        <View className="mt-3">
          <Button
            title={constituents.loadingMore ? 'Loading…' : 'Load more'}
            variant="secondary"
            onPress={loadMore}
          />
        </View>
      ) : null}

      {stocks.length === 0 ? (
        <Text variant="muted" className="mt-2">
          No stocks yet for {contextName}.
        </Text>
      ) : null}
    </Screen>
  );
}

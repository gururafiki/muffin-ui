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
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { analyseSector, getCountry, getRegion, getSector } from '@/features/markets/taxonomy';

export default function SectorScreen() {
  const params = useLocalSearchParams<{ sectorId: string; countryId?: string }>();
  const router = useRouter();
  const sector = getSector(params.sectorId);
  const country = params.countryId ? getCountry(params.countryId) : undefined;
  const region = country ? getRegion(country.regionId) : undefined;

  // Hooks run before the early return below — `sector` can be undefined.
  const period = useActivePeriod(SECTOR_PERIODS);
  const [limit, setLimit] = useState(SECTOR_PAGE_SIZE);
  // Drilling in from a country page means "this sector IN this country".
  const constituents = useSectorConstituents(params.sectorId ?? '', period, {
    country: country?.name,
    limit,
  });

  const goStock = (ticker: string) =>
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
  const subSectors = constituents.subSectors.length > 0 ? constituents.subSectors : sector.subSectors;
  const movers = stocks
    .filter((s) => s.changePct !== null)
    // No `sublabel`: MoversPanel PREFIXES it before the label (it is meant for a
    // flag emoji), so a country name there reads "United States AAPL · Apple Inc.".
    // The list below already carries industry · country.
    .map((s) => ({ key: s.symbol, label: `${s.symbol} · ${s.name}`, changePct: s.changePct as number }));

  return (
    <Screen>
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
        <View className="flex-row flex-wrap gap-2">
          {subSectors.map((s) => (
            // Only de-hyphenate authored SLUGS ('software-saas'). A real provider
            // industry ('Software - Application') already has spaces, and the same
            // replace turned its separator into a double space.
            <Chip key={s} label={s.includes(' ') ? s : s.replace(/-/g, ' ')} />
          ))}
        </View>
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
        <Freshness
          sample={constituents.sample}
          asOf={constituents.asOf}
          source={constituents.source}
          refreshing={constituents.refreshing}
        />
      </View>
      <View className="mt-2">
        <DrillList
          items={stocks.map((s) => ({
            key: s.symbol,
            title: `${s.symbol} · ${s.name}`,
            // The provider's real industry is the sub-sector; country second.
            subtitle: [s.industry, s.country].filter(Boolean).join(' · '),
            changePct: s.changePct ?? undefined,
          }))}
          onSelect={goStock}
        />
      </View>

      {constituents.hasMore ? (
        <View className="mt-3">
          <Button
            title={constituents.loadingMore ? 'Loading…' : 'Load more'}
            variant="secondary"
            onPress={() => setLimit((n) => n + SECTOR_PAGE_SIZE)}
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

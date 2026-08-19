import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Icon } from '@/components/icons';
import { Card, Screen, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { COUNTRY_PERIODS, useCountryPerformance } from '@/features/markets/api/use-country-performance';
import { useCountries } from '@/features/markets/api/use-countries';
import { Breadcrumb } from '@/features/markets/breadcrumb';
import { DrillList } from '@/features/markets/drill-list';
import { Freshness } from '@/features/markets/freshness';
import { ListSearch, useListSearch } from '@/features/markets/list-search';
import { MoversPanel } from '@/features/markets/movers-panel';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { analyseRegion, getRegion, marketLabel } from '@/features/markets/taxonomy';

export default function RegionScreen() {
  const { regionId } = useLocalSearchParams<{ regionId: string }>();
  const router = useRouter();
  const region = getRegion(regionId);

  const goCountry = (id: string) =>
    router.push({ pathname: '/country/[countryId]', params: { countryId: id } });

  // MOUNTED, NOT ASSUMED. `countriesInRegion` used to read the BUNDLED 19-country array while
  // every sibling lookup read the server-backed registry of 45 — so this page listed 19 countries
  // and the group page beside it listed 45, disagreeing about the same world. Reading the registry
  // is only half the fix: a registry filled by a hook does not survive a DEEP LINK, so the page
  // that resolves the route param has to mount the query itself (the same rule `useCountry`
  // follows on the country page).
  const countries = useCountries();
  const period = useActivePeriod(COUNTRY_PERIODS);
  const perf = useCountryPerformance(period);

  // DERIVED AND SEARCHED BEFORE THE EARLY RETURN. Hooks must run in the same order on every
  // render, so `useListSearch` cannot sit below `if (!region)` — an unknown region would render
  // one fewer hook and React would mismatch the next one.
  const inRegion = region ? countries.items.filter((c) => c.regionId === region.id) : [];
  const countrySearch = useListSearch(inRegion, (c) => [c.name, c.iso]);

  // THE SERVER LIST CARRIES NO RETURN — `fetchCountries` maps every row to `changePct: 0`. So the
  // number has to come from `useCountryPerformance`, keyed by ISO. Rendering the registry's own
  // field would have put a confident "0.00%" against all 45 countries, which is a wrong number
  // rather than a missing one. While the app is still on the bundled seed the authored value is
  // used and the Freshness badge says SAMPLE; once live, a country with no server row shows NO
  // number rather than its authored one.
  const changeFor = (iso: string, authored: number) =>
    perf.sample ? authored : perf.byIso.get(iso);
  const movers = inRegion
    .map((c) => ({ key: c.id, label: c.name, sublabel: c.flag, changePct: changeFor(c.iso, c.changePct) }))
    .filter((m): m is { key: string; label: string; sublabel: string; changePct: number } =>
      m.changePct !== undefined);

  if (!region) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown region</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: region.name }} />
      <Breadcrumb crumbs={[{ label: 'Globe', href: '/' }, { label: region.name }]} />

      <Card tone="sticker" className="mt-1 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
          <Icon name={region.icon} size={28} color={palette.frosting[600]} />
        </View>
        <View className="flex-1">
          <Text variant="title">{region.name}</Text>
          <Text variant="muted">{region.blurb}</Text>
        </View>
      </Card>

      <View className="mt-4 flex-row items-center justify-between">
        <Text variant="label">Country performance</Text>
        <Freshness
          sample={perf.sample}
          asOf={perf.asOf}
          source={perf.source}
          refreshing={perf.refreshing}
        />
      </View>
      <View className="mt-2">
        <PeriodPicker periods={COUNTRY_PERIODS} />
      </View>
      <View className="mt-2">
        <MoversPanel title="Country performance" items={movers} onSelect={goCountry} />
      </View>

      <View className="mt-4">
        <AnalyseButton title={`Analyse ${region.name} economy`} query={analyseRegion(region.name)} />
      </View>

      <Text variant="label" className="mt-5">
        Countries
      </Text>
      {/* Filtered in memory: the region's countries are already loaded, so this needs no round trip
          and therefore no debounce, no loading state and no partial page. */}
      <ListSearch
        value={countrySearch.query}
        onChange={countrySearch.setQuery}
        placeholder="Search countries"
        label="Search countries in this region"
      />
      <View className="mt-2">
        <DrillList
          items={countrySearch.shown.map((c) => ({
            key: c.id,
            title: c.name,
            subtitle: marketLabel(c.market),
            leading: c.flag,
            changePct: changeFor(c.iso, c.changePct),
          }))}
          onSelect={goCountry}
        />
      </View>
    </Screen>
  );
}

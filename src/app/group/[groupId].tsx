import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Card, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { COUNTRY_PERIODS, useCountryPerformance } from '@/features/markets/api/use-country-performance';
import { useScheme } from '@/features/markets/api/use-classification';
import { useGroupPerformance } from '@/features/markets/api/use-group-performance';
import { groupById, type LensId, type SchemeId } from '@/features/markets/classification';
import { DrillList } from '@/features/markets/drill-list';
import { ListSearch, useListSearch } from '@/features/markets/list-search';
import { Freshness } from '@/features/markets/freshness';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { PAGE_RESOURCES, RefreshButton } from '@/features/markets/refresh-button';
import { WORLD_GEO } from '@/features/markets/world-geo';
import { WorldMap } from '@/features/markets/world-map';
import { analyseRegion, getCountryByIso, marketLabel } from '@/features/markets/taxonomy';
import { useCountries } from '@/features/markets/api/use-countries';

export default function GroupScreen() {
  const params = useLocalSearchParams<{ groupId: string; scheme: SchemeId; lens: LensId }>();
  const router = useRouter();
  const schemeId = (params.scheme ?? 'msci') as SchemeId;
  const lens = (params.lens ?? 'region') as LensId;

  // Hooks run before the early return below — `group` can be undefined.
  const { scheme } = useScheme(schemeId);
  const countries = useCountries();
  const period = useActivePeriod(COUNTRY_PERIODS);
  const perf = useCountryPerformance(period);
  // Growth for the tier itself, from its proxy fund — the same treatment sectors and countries get.
  const growth = useGroupPerformance(schemeId, params.groupId ?? '', period);

  const group = groupById(scheme, lens, params.groupId);

  const goCountry = (id: string) =>
    router.push({ pathname: '/country/[countryId]', params: { countryId: id } });

  // DERIVED AND SEARCHED BEFORE THE EARLY RETURN. Hooks must run in the same order on every
  // render, so `useListSearch` cannot sit below `if (!group)` — an unknown group would render one
  // fewer hook and React would mismatch the next one.
  const inGroup = (iso: string) => (group ? scheme.groupOf(lens, iso) === group.id : false);
  const modelled = countries.items.filter((c) => inGroup(c.iso));
  const groupSearch = useListSearch(modelled, (c) => [c.name, c.iso]);

  if (!group) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown group</Text>
        </Card>
      </Screen>
    );
  }
  const otherNames = WORLD_GEO.filter(
    (c) => inGroup(c.iso) && !getCountryByIso(c.iso),
  ).map((c) => c.name);

  return (
    <Screen>
      <Stack.Screen options={{ title: group.name }} />

      <Card tone="sticker" className="mt-1 gap-2">
        <View className="flex-row items-center gap-3">
          <View style={{ backgroundColor: group.color }} className="h-10 w-10 rounded-crumb" />
          <View className="flex-1">
            <Text variant="title">{group.name}</Text>
            <Text variant="muted">
              {scheme.name} · {scheme.lensLabel[lens]}
              {group.etf ? ` · ETF ${group.etf}` : ''}
            </Text>
          </View>
          {/* No number is the honest render for a group with no investable proxy — the World Bank
              income bands have no ETF, so there is nothing to price. */}
          {growth.changePct !== null ? (
            <Text
              className={growth.changePct >= 0 ? 'font-heading text-bullish' : 'font-heading text-bearish'}>
              {growth.changePct >= 0 ? '+' : ''}
              {growth.changePct.toFixed(1)}%
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center justify-between">
          <PeriodPicker />
          <View className="flex-row items-center gap-2">
            {growth.changePct !== null ? (
              <Freshness sample={growth.sample} asOf={growth.asOf} source={growth.source} />
            ) : null}
            <RefreshButton
              resources={[...PAGE_RESOURCES.group]}
              invalidate={[['market', 'performance', 'group']]}
            />
          </View>
        </View>
      </Card>

      <View className="mt-4">
        <WorldMap
          scheme={scheme}
          lens={lens}
          focusGroup={group.id}
          onSelectCountry={(iso) => {
            const c = getCountryByIso(iso);
            if (c) goCountry(c.id);
          }}
        />
      </View>

      <View className="mt-4">
        <AnalyseButton title={`Analyse ${group.name}`} query={analyseRegion(group.name)} variant="butter" />
      </View>

      {modelled.length > 0 ? (
        <>
          <View className="mt-5 flex-row items-center justify-between">
            <Text variant="label">Markets we model</Text>
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
          {/* In-memory: the group's countries are already loaded. */}
          <ListSearch
            value={groupSearch.query}
            onChange={groupSearch.setQuery}
            placeholder="Search countries"
            label="Search countries in this group"
          />
          <View className="mt-2">
            <DrillList
              items={groupSearch.shown.map((c) => ({
                key: c.id,
                title: c.name,
                subtitle: marketLabel(c.market),
                leading: c.flag,
                // Live value for the active period. Once live, a country with no
                // server row shows NO number rather than its authored one — mixing
                // the two unlabelled is what the sample badge exists to prevent.
                changePct: perf.sample ? c.changePct : perf.byIso.get(c.iso),
              }))}
              onSelect={goCountry}
            />
          </View>
        </>
      ) : null}

      {otherNames.length > 0 ? (
        <Card tone="muted" className="mt-4 gap-1">
          <Text variant="label">Also in this group ({otherNames.length})</Text>
          <Text variant="muted">{otherNames.join(' · ')}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

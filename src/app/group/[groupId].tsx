import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Card, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { COUNTRY_PERIODS, useCountryPerformance } from '@/features/markets/api/use-country-performance';
import { useScheme } from '@/features/markets/api/use-classification';
import { groupById, type LensId, type SchemeId } from '@/features/markets/classification';
import { DrillList } from '@/features/markets/drill-list';
import { Freshness } from '@/features/markets/freshness';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { WORLD_GEO } from '@/features/markets/world-geo';
import { WorldMap } from '@/features/markets/world-map';
import { analyseRegion, COUNTRIES, getCountryByIso } from '@/features/markets/taxonomy';

export default function GroupScreen() {
  const params = useLocalSearchParams<{ groupId: string; scheme: SchemeId; lens: LensId }>();
  const router = useRouter();
  const schemeId = (params.scheme ?? 'msci') as SchemeId;
  const lens = (params.lens ?? 'region') as LensId;

  // Hooks run before the early return below — `group` can be undefined.
  const { scheme } = useScheme(schemeId);
  const period = useActivePeriod(COUNTRY_PERIODS);
  const perf = useCountryPerformance(period);

  const group = groupById(scheme, lens, params.groupId);

  const goCountry = (id: string) =>
    router.push({ pathname: '/country/[countryId]', params: { countryId: id } });

  if (!group) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown group</Text>
        </Card>
      </Screen>
    );
  }

  const inGroup = (iso: string) => scheme.groupOf(lens, iso) === group.id;
  const modelled = COUNTRIES.filter((c) => inGroup(c.iso));
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
          <View className="mt-2">
            <DrillList
              items={modelled.map((c) => ({
                key: c.id,
                title: c.name,
                subtitle: c.market === 'developed' ? 'Developed market' : 'Emerging market',
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

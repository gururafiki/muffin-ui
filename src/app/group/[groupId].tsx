import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Card, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { getScheme, groupById, type LensId, type SchemeId } from '@/features/markets/classification';
import { DrillList } from '@/features/markets/drill-list';
import { WORLD_GEO } from '@/features/markets/world-geo';
import { WorldMap } from '@/features/markets/world-map';
import { analyseRegion, COUNTRIES, getCountryByIso } from '@/features/markets/taxonomy';

export default function GroupScreen() {
  const params = useLocalSearchParams<{ groupId: string; scheme: SchemeId; lens: LensId }>();
  const router = useRouter();
  const schemeId = (params.scheme ?? 'msci') as SchemeId;
  const lens = (params.lens ?? 'region') as LensId;
  const scheme = getScheme(schemeId);
  const group = groupById(scheme, lens, params.groupId);

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

  const goCountry = (id: string) =>
    router.push({ pathname: '/country/[countryId]', params: { countryId: id } });

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
          scheme={schemeId}
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
          <Text variant="label" className="mt-5">
            Markets we model
          </Text>
          <View className="mt-2">
            <DrillList
              items={modelled.map((c) => ({
                key: c.id,
                title: c.name,
                subtitle: c.market === 'developed' ? 'Developed market' : 'Emerging market',
                leading: c.flag,
                changePct: c.changePct,
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

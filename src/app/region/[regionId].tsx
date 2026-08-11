import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Icon } from '@/components/icons';
import { Card, Screen, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { Breadcrumb } from '@/features/markets/breadcrumb';
import { DrillList } from '@/features/markets/drill-list';
import { MoversPanel } from '@/features/markets/movers-panel';
import { analyseRegion, countriesAsMovers, countriesInRegion, getRegion, marketLabel } from '@/features/markets/taxonomy';

export default function RegionScreen() {
  const { regionId } = useLocalSearchParams<{ regionId: string }>();
  const router = useRouter();
  const region = getRegion(regionId);

  const goCountry = (id: string) =>
    router.push({ pathname: '/country/[countryId]', params: { countryId: id } });

  if (!region) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown region</Text>
        </Card>
      </Screen>
    );
  }

  const countries = countriesInRegion(region.id);

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

      <View className="mt-4">
        <MoversPanel title="Country performance" items={countriesAsMovers(region.id)} onSelect={goCountry} />
      </View>

      <View className="mt-4">
        <AnalyseButton title={`Analyse ${region.name} economy`} query={analyseRegion(region.name)} />
      </View>

      <Text variant="label" className="mt-5">
        Countries
      </Text>
      <View className="mt-2">
        <DrillList
          items={countries.map((c) => ({
            key: c.id,
            title: c.name,
            subtitle: marketLabel(c.market),
            leading: c.flag,
            changePct: c.changePct,
          }))}
          onSelect={goCountry}
        />
      </View>
    </Screen>
  );
}

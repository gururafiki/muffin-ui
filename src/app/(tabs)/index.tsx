import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { MuffinLogo, ScallopDivider, Screen, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { DrillList } from '@/features/markets/drill-list';
import { WorldMap } from '@/features/markets/world-map';
import { analyseGlobalMacro, REGIONS } from '@/features/markets/taxonomy';
import { palette } from '@/theme/colors';

export default function HomeScreen() {
  const router = useRouter();
  const goRegion = (id: string) =>
    router.push({ pathname: '/region/[regionId]', params: { regionId: id } });

  return (
    <Screen plaid contentClassName="px-4">
      {/* Grape hero banner with a scalloped bottom edge */}
      <View className="overflow-hidden rounded-bun">
        <View className="items-center gap-1 bg-frosting-700 px-5 pb-5 pt-7">
          <MuffinLogo size={76} />
          <Text className="font-display text-4xl text-white">Muffin</Text>
          <Text className="w-full text-center font-body text-frosting-100">
            Democratise wealth building. Explore the world, then dig in.
          </Text>
        </View>
        <ScallopDivider color={palette.frosting[700]} height={16} scallops={16} />
      </View>

      <View className="mt-4">
        <WorldMap onSelectRegion={goRegion} />
      </View>

      <View className="mt-4">
        <AnalyseButton title="Analyse global macro" query={analyseGlobalMacro()} variant="butter" />
      </View>

      <Text variant="label" className="mt-6">
        Regions
      </Text>
      <Text variant="muted" className="mb-3">
        Tap a region on the map, or pick one below.
      </Text>

      <DrillList
        items={REGIONS.map((r) => ({
          key: r.id,
          title: r.name,
          subtitle: r.blurb,
          icon: r.icon,
          changePct: r.changePct,
        }))}
        onSelect={goRegion}
      />
    </Screen>
  );
}

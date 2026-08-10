import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import { useSectorPerformance } from '@/features/markets/api/use-sector-performance';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { Breadcrumb } from '@/features/markets/breadcrumb';
import { DrillList } from '@/features/markets/drill-list';
import { MoversPanel } from '@/features/markets/movers-panel';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { PAGE_RESOURCES, RefreshButton } from '@/features/markets/refresh-button';
import { analyseCountry, getCountry, getRegion, SECTORS } from '@/features/markets/taxonomy';

export default function CountryScreen() {
  const { countryId } = useLocalSearchParams<{ countryId: string }>();
  const router = useRouter();
  const country = getCountry(countryId);
  const region = country ? getRegion(country.regionId) : undefined;

  // Hooks must run before the early return below — `country` can be undefined.
  const period = useActivePeriod();
  const sectors = useSectorPerformance(period);
  const changeById = new Map(sectors.items.map((i) => [i.key, i.changePct]));

  const goSector = (id: string) =>
    router.push({ pathname: '/sector/[sectorId]', params: { sectorId: id, countryId: country?.id ?? '' } });

  if (!country) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown country</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: country.name }} />
      <Breadcrumb
        crumbs={[
          { label: 'Globe', href: '/' },
          ...(region ? [{ label: region.name, href: { pathname: '/region/[regionId]' as const, params: { regionId: region.id } } }] : []),
          { label: country.name },
        ]}
      />

      <Card className="mt-1 gap-2">
        <Text variant="title">
          {country.flag} {country.name}
        </Text>
        <Badge label={country.market === 'developed' ? 'Developed market' : 'Emerging market'} tone="info" />
      </Card>

      <View className="mt-4">
        {/* NAMED AS US, because it is. `scope=sector` comes from finviz's `equity/compare/groups`,
            which is US-listed ONLY — so on a South Korea page these are US sector returns. Left
            unlabelled it reads as "Korea's sectors", which is why none of them matched EWY's
            +121.9%. Per-country sector returns are tracked in todos.md. */}
        <MoversPanel
          title="US sector performance"
          items={sectors.items}
          onSelect={goSector}
          sample={sectors.sample}
          asOf={sectors.asOf}
          source={sectors.source}
          refreshing={sectors.refreshing}
          right={
            <View className="flex-row items-center gap-2">
              <RefreshButton
                resources={[...PAGE_RESOURCES.country]}
                invalidate={[['market', 'performance', 'country'], ['market', 'performance', 'sector']]}
              />
              <PeriodPicker />
            </View>
          }
        />
      </View>

      <View className="mt-4">
        <AnalyseButton title={`Analyse ${country.name} economy`} query={analyseCountry(country.name)} />
      </View>

      <Text variant="label" className="mt-5">
        Sectors
      </Text>
      <View className="mt-2">
        <DrillList
          items={SECTORS.map((s) => ({
            key: s.id,
            title: s.name,
            // No "N sub-sectors" subtitle: that counted the AUTHORED slugs
            // ('software-saas'), which the sector page stopped showing because nothing
            // backs them. Advertising a taxonomy depth that does not exist here while the
            // page it links to shows none would be the same claim made twice.
            icon: s.icon,
            // Once the panel above is live, this list is live too: a sector the
            // server has no row for shows NO number rather than falling back to
            // its authored one. Mixing them would put a real +11.1% and an
            // authored +9.4% side by side with nothing to tell them apart —
            // exactly what the sample badge exists to prevent.
            changePct: sectors.sample ? s.changePct : changeById.get(s.id),
          }))}
          onSelect={goSector}
        />
      </View>
    </Screen>
  );
}

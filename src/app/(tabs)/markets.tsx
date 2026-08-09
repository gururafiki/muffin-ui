import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Button, Card, Chip, Screen, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useAssetUniverse } from '@/features/markets/api/use-asset-universe';
import { useSectorPerformance } from '@/features/markets/api/use-sector-performance';
import { DrillList } from '@/features/markets/drill-list';
import { Freshness } from '@/features/markets/freshness';
import { MoversPanel } from '@/features/markets/movers-panel';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { SectorPie } from '@/features/markets/sector-pie';
import {
  ASSET_TYPES,
  assetTypeMeta,
  getSector,
  SECTOR_WEIGHTS,
  type AssetType,
} from '@/features/markets/taxonomy';

export default function MarketsScreen() {
  const router = useRouter();
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<AssetType | 'all'>('all');

  const sector = selectedSector ? getSector(selectedSector) : undefined;
  const goSector = (id: string) =>
    router.push({ pathname: '/sector/[sectorId]', params: { sectorId: id } });

  const period = useActivePeriod();
  const sectors = useSectorPerformance(period);
  const universe = useAssetUniverse(period, assetFilter);
  const assets = universe.items;

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Markets
      </Text>
      <Text variant="muted">Sector weights and your multi-asset universe.</Text>

      <View className="mt-4">
        <MoversPanel
          title="Sector performance"
          items={sectors.items}
          onSelect={goSector}
          sample={sectors.sample}
          asOf={sectors.asOf}
          source={sectors.source}
          refreshing={sectors.refreshing}
          right={<PeriodPicker />}
        />
      </View>

      <Card className="mt-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text variant="heading">Sector breakdown</Text>
          {/* Weights are still SECTOR_WEIGHTS, an authored map — only the
              performance numbers above are live so far. */}
          <Freshness sample />
        </View>
        <SectorPie selectedId={selectedSector} onSelect={setSelectedSector} />

        {sector ? (
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Icon name={sector.icon} size={22} color={palette.frosting[600]} />
              <Text variant="heading">{sector.name}</Text>
              <Text variant="muted">{SECTOR_WEIGHTS[sector.id]}% weight</Text>
            </View>
            <Text variant="label">Sub-sectors</Text>
            <View className="flex-row flex-wrap gap-2">
              {sector.subSectors.map((s) => (
                <Chip key={s} label={s.replace(/-/g, ' ')} onPress={() => goSector(sector.id)} />
              ))}
            </View>
            <Button title={`Open ${sector.name}`} variant="secondary" onPress={() => goSector(sector.id)} />
          </View>
        ) : (
          <Text variant="muted" className="text-center">
            Tap a slice to drill into a sector.
          </Text>
        )}
      </Card>

      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Asset universe</Text>
        <Freshness
          sample={universe.sample}
          asOf={universe.asOf}
          source={universe.source}
          refreshing={universe.refreshing}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
        <View className="flex-row gap-2 pr-4">
          <Chip label="All" active={assetFilter === 'all'} onPress={() => setAssetFilter('all')} />
          {ASSET_TYPES.map((t) => (
            <Chip
              key={t.id}
              icon={t.icon}
              label={t.name}
              active={assetFilter === t.id}
              onPress={() => setAssetFilter(t.id)}
            />
          ))}
        </View>
      </ScrollView>

      <View className="mt-3">
        <DrillList
          items={assets.map((a) => ({
            key: a.symbol,
            title: `${a.symbol} · ${a.name}`,
            // Prefer the provider's real industry over the asset-type label.
            subtitle: [
              a.industry ?? (a.sectorId ? getSector(a.sectorId)?.name : assetTypeMeta(a.assetType)?.name),
              a.country,
            ]
              .filter(Boolean)
              .join(' · '),
            icon: assetTypeMeta(a.assetType)?.icon,
            changePct: a.changePct ?? undefined,
          }))}
          onSelect={(symbol) => {
            const a = assets.find((x) => x.symbol === symbol);
            router.push({
              pathname: '/stock/[ticker]',
              params: {
                ticker: symbol,
                sector: a?.sectorId ?? '',
                country: a?.country ?? '',
                assetType: a?.assetType ?? '',
              },
            });
          }}
        />
      </View>
    </Screen>
  );
}

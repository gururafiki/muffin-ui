import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Button, Card, MuffinLogo, ScallopDivider, Screen, Segmented, Text } from '@/components/ui';
import { AnalyseButton } from '@/features/markets/analyse-button';
import {
  getScheme,
  groupById,
  SCHEMES,
  type LensId,
  type SchemeId,
} from '@/features/markets/classification';
import { nameForIso } from '@/features/markets/geo-utils';
import { useMapView } from '@/features/markets/map-view-store';
import { analyseCountry, analyseGlobalMacro, getCountryByIso } from '@/features/markets/taxonomy';
import { WorldMap } from '@/features/markets/world-map';
import { palette } from '@/theme/colors';

export default function HomeScreen() {
  const router = useRouter();
  const { scheme: schemeId, lens, setScheme, setLens } = useMapView();
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const scheme = getScheme(schemeId);
  const groups = scheme.groups[lens];

  const sel = selectedIso
    ? {
        iso: selectedIso,
        name: nameForIso(selectedIso),
        region: groupById(scheme, 'region', scheme.groupOf('region', selectedIso)),
        tier: groupById(scheme, 'tier', scheme.groupOf('tier', selectedIso)),
        country: getCountryByIso(selectedIso),
      }
    : null;

  const openGroup = (groupId: string) =>
    router.push({ pathname: '/group/[groupId]', params: { groupId, scheme: schemeId, lens } });

  return (
    <Screen plaid contentClassName="px-4">
      {/* Compact grape hero */}
      <View className="overflow-hidden rounded-bun">
        <View className="flex-row items-center gap-3 bg-frosting-700 px-4 pb-4 pt-5">
          <MuffinLogo size={48} />
          <View className="flex-1">
            <Text className="font-display text-2xl text-white">Muffin</Text>
            <Text className="font-body text-xs text-frosting-100">
              The investable world — your lens.
            </Text>
          </View>
        </View>
        <ScallopDivider color={palette.frosting[700]} height={14} scallops={16} />
      </View>

      {/* Scheme + lens switchers */}
      <Card tone="muted" className="mt-4 gap-3">
        <View className="gap-1.5">
          <Text variant="label">Classification</Text>
          <Segmented
            options={SCHEMES.map((s) => ({ id: s.id, label: s.name }))}
            value={schemeId}
            onChange={(id: SchemeId) => setScheme(id)}
          />
        </View>
        <View className="gap-1.5">
          <Text variant="label">Group by</Text>
          <Segmented
            options={[
              { id: 'region' as LensId, label: scheme.lensLabel.region },
              { id: 'tier' as LensId, label: scheme.lensLabel.tier },
            ]}
            value={lens}
            onChange={(id: LensId) => setLens(id)}
          />
        </View>
        <Text variant="muted" className="text-xs">
          {scheme.blurb}
        </Text>
      </Card>

      {/* Map */}
      <View className="mt-4">
        <WorldMap
          scheme={schemeId}
          lens={lens}
          selectedIso={selectedIso}
          onSelectCountry={(iso) => setSelectedIso((cur) => (cur === iso ? null : iso))}
        />
      </View>

      {/* Selected country */}
      {sel ? (
        <Card tone="sticker" className="mt-3 gap-2">
          <View className="flex-row items-start justify-between">
            <Text variant="heading" className="flex-1">
              {sel.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss country details"
              onPress={() => setSelectedIso(null)}
              hitSlop={8}>
              <Icon name="close" size={18} color={palette.frosting[400]} weight="bold" />
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {sel.region ? <GroupPill color={sel.region.color} label={sel.region.name} /> : null}
            {sel.tier ? <GroupPill color={sel.tier.color} label={sel.tier.name} /> : null}
            {sel.region?.etf ? <GroupPill color={palette.frosting[400]} label={`ETF · ${sel.region.etf}`} /> : null}
          </View>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {sel.country ? (
              <Button
                title={`Open ${sel.name}`}
                variant="secondary"
                size="sm"
                onPress={() =>
                  router.push({ pathname: '/country/[countryId]', params: { countryId: sel.country!.id } })
                }
              />
            ) : null}
            <AnalyseButton title={`Analyse ${sel.name}`} query={analyseCountry(sel.name)} variant="butter" />
          </View>
        </Card>
      ) : (
        <Text variant="muted" className="mt-2 text-center text-xs">
          Tap a country on the map, or pick a {scheme.lensLabel[lens].toLowerCase()} below.
        </Text>
      )}

      {/* Legend / groups */}
      <Text variant="label" className="mt-5">
        {scheme.lensLabel[lens]}
      </Text>
      <View className="mt-2 gap-2">
        {groups.map((g) => (
          <Pressable key={g.id} onPress={() => openGroup(g.id)} className="active:opacity-80">
            <Card tone="sticker" className="flex-row items-center gap-3 py-3">
              <View style={{ backgroundColor: g.color }} className="h-5 w-5 rounded-crumb" />
              <Text variant="body" className="flex-1 font-heading">
                {g.name}
              </Text>
              {g.etf ? <Text variant="muted">{g.etf}</Text> : null}
              <Icon name="chevron-right" size={18} color={palette.frosting[300]} weight="bold" />
            </Card>
          </Pressable>
        ))}
      </View>

      <View className="mt-4">
        <AnalyseButton title="Analyse global macro" query={analyseGlobalMacro()} variant="butter" />
      </View>
    </Screen>
  );
}

function GroupPill({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-pill border border-frosting-200 bg-white px-2.5 py-1 dark:border-night-border dark:bg-night-surface">
      <View style={{ backgroundColor: color }} className="h-3 w-3 rounded-full" />
      <Text variant="muted" className="text-xs">
        {label}
      </Text>
    </View>
  );
}

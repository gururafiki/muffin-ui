/**
 * The securities no list will show, because they are not placed anywhere.
 *
 * A universe of 12,348 equities that silently hides ~1,300 of them is worse than one that says
 * "and these are the ones I could not place". Two kinds, both honest gaps in classification rather
 * than errors:
 *
 *   no country  267 sit in jurisdictions with no page (Cayman, Bermuda, BVI — N-PORT reports the
 *               INCORPORATION jurisdiction, which is why Alibaba is filed under KY) and 84 have no
 *               country at all
 *   no sector   1,290 are not classified yet
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { View } from 'react-native';

import { Card, Screen, Segmented, Text } from '@/components/ui';
import { useCountries } from '@/features/markets/api/use-countries';
import { useUnplaced, type UnplacedKind } from '@/features/markets/api/use-unplaced';
import { ListSearch, useListSearch } from '@/features/markets/list-search';
import { DrillList } from '@/features/markets/drill-list';

const KINDS: { id: UnplacedKind; label: string }[] = [
  { id: 'no-sector', label: 'No sector' },
  { id: 'no-country', label: 'No country page' },
];

export default function OtherScreen() {
  const params = useLocalSearchParams<{ kind?: UnplacedKind; countryId?: string; countryIso?: string }>();
  const router = useRouter();
  const kind: UnplacedKind = params.kind === 'no-country' ? 'no-country' : 'no-sector';

  // The countries that HAVE a page. `useCountries` already returns only drillable ones, so this is
  // exactly the set the app can browse to — computed from what it can show rather than from a
  // hardcoded list of tax havens.
  const countries = useCountries();
  const drillable = countries.items.map((c) => c.iso);

  const unplaced = useUnplaced(kind, drillable, params.countryIso);
  const search = useListSearch(unplaced.items, (s) => [s.name, s.symbol, s.countryName]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Other' }} />
      <Text variant="display" className="pt-4">Other</Text>
      <Text variant="muted" className="mt-1">
        Securities the lists cannot place. Not errors — gaps in classification.
      </Text>

      <View className="mt-3">
        <Segmented
          options={KINDS}
          value={kind}
          onChange={(v) => router.setParams({ kind: v as UnplacedKind })}
        />
      </View>

      <Text variant="muted" className="mt-3 text-xs">
        {kind === 'no-country'
          ? 'Filed under a jurisdiction with no market page — usually an offshore incorporation such as Cayman or Bermuda — or with no country at all.'
          : 'Not classified into a sector yet. The classification backlog fills these as the provider answers.'}
      </Text>

      <ListSearch
        value={search.query}
        onChange={search.setQuery}
        placeholder="Search these securities"
        label="Search unplaced securities"
      />

      {unplaced.capped ? (
        <Text variant="muted" className="mt-1 text-xs">
          Showing the first {unplaced.items.length}, alphabetically — there are more.
        </Text>
      ) : null}

      {!unplaced.loading && unplaced.items.length === 0 ? (
        <Card tone="muted" className="mt-4">
          <Text>Nothing unplaced here.</Text>
          <Text className="mt-1 text-xs text-ink-soft">
            Every security in this scope has been classified.
          </Text>
        </Card>
      ) : null}

      <View className="mt-2">
        <DrillList
          items={search.shown.map((s) => ({
            key: s.id,
            title: s.symbol ? `${s.symbol} · ${s.name}` : s.name,
            subtitle: s.countryName ?? s.countryIso ?? 'No country on file',
          }))}
          // Keyed on `security_id`: a security with no listing has no ticker at all, and several
          // such rows would collide on an empty key. Only a row WITH a symbol can open a page —
          // the app cannot show one it cannot price, so the rest are inert rather than broken.
          onSelect={(key) => {
            const hit = search.shown.find((x) => x.id === key);
            if (hit?.symbol) router.push({ pathname: '/stock/[ticker]', params: { ticker: hit.symbol } });
          }}
        />
      </View>
    </Screen>
  );
}

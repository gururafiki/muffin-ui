import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import { useSectorPerformance } from '@/features/markets/api/use-sector-performance';
import { AnalyseButton } from '@/features/markets/analyse-button';
import { Breadcrumb } from '@/features/markets/breadcrumb';
import { MacroPanel } from '@/features/markets/macro-panel';
import { DrillList } from '@/features/markets/drill-list';
import { MoversPanel } from '@/features/markets/movers-panel';
import { useCountry } from '@/features/markets/api/use-countries';
import { useCountrySectorPerformance } from '@/features/markets/api/use-country-sector-performance';
import { PeriodPicker, useActivePeriod } from '@/features/markets/period-picker';
import { PAGE_RESOURCES, RefreshButton } from '@/features/markets/refresh-button';
import { analyseCountry, getRegion, getSector, marketLabel, SECTORS } from '@/features/markets/taxonomy';

export default function CountryScreen() {
  const { countryId } = useLocalSearchParams<{ countryId: string }>();
  const router = useRouter();
  const { country, pending } = useCountry(countryId);
  const region = country ? getRegion(country.regionId) : undefined;

  // Hooks must run before the early return below — `country` can be undefined.
  const period = useActivePeriod();
  const sectors = useSectorPerformance(period);
  // The country's own sector returns; `sectors` (US, from finviz) remains the fallback.
  const own = useCountrySectorPerformance(country?.iso, period);

  // ONE source for both the panel and the list below it. They were separate, so the panel showed
  // Korean technology at +309% while the list under it showed the US figure of +31.5% — the same
  // sector, on the same screen, disagreeing by an order of magnitude.
  const changeById = own.empty
    ? new Map(sectors.items.map((i) => [i.key, i.changePct]))
    : new Map(own.items.map((i) => [i.sectorId, i.changePct]));
  const ownMovers = own.items.map((i) => ({
    key: i.sectorId,
    // Coverage travels WITH the number, in the LABEL: a mean over 4 names holding 61% of a fund
    // is a different claim from one over 31 holding 21%, and the reader cannot tell them apart
    // otherwise. Not `sublabel` — MoversPanel PREFIXES that (it is meant for a flag emoji), so it
    // would read "61% Information Technology".
    label: `${getSector(i.sectorId)?.name ?? i.sectorId} · ${i.weightPct.toFixed(0)}%`,
    changePct: i.changePct,
  }));

  const goSector = (id: string) =>
    router.push({ pathname: '/sector/[sectorId]', params: { sectorId: id, countryId: country?.id ?? '' } });

  if (!country) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          {/* The country list is server-side, so a deep link arrives before it does. Saying
              "unknown" during that window would call a real country nonexistent. */}
          <Text variant="heading">{pending ? 'Loading country…' : 'Unknown country'}</Text>
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
        <Badge label={marketLabel(country.market)} tone="info" />
      </Card>

      <View className="mt-4">
        {/* THIS COUNTRY's sectors, weighted by its own fund — not America's. The page used to
            show finviz's `equity/compare/groups`, which is US-listed only, so Korea displayed US
            sector returns and none of them matched EWY's +121.9%. They do now: Korean technology
            is the reason, at +309% carrying 61% of the fund.

            A COUNTRY WITH NO COVERAGE NOW SAYS SO. It used to fall back to the US panel, labelled
            "US sector performance" — the reasoning being that a labelled substitute beats an empty
            card. Alex opened Vietnam, saw US sectors, and read it as a bug. It is: 45 countries are
            drillable and only 26 have their own sector rows, so 19 of them showed American numbers
            on a page about somewhere else, and a label is a weaker signal than the eleven familiar
            sector names sitting there looking local. An honest gap beats a labelled substitute. */}
        {own.empty ? (
          <Card tone="muted">
            <Text variant="label">Sectors</Text>
            <Text className="mt-1 text-ink-muted">
              No sector data for {country.name}.
            </Text>
            <Text className="mt-2 text-xs text-ink-soft">
              Sector returns are weighted from the securities a country fund actually holds. No
              tracked fund reports holdings for {country.name} yet, so there is nothing to weight.
            </Text>
          </Card>
        ) : (
        <MoversPanel
          title={
            // Names the fund, because "61%" is unattributable otherwise: a reader cannot tell
            // whether it is a share of the country's ETF or of something else entirely.
            `${country.name} sectors${own.fundSymbol ? ` · ${own.fundSymbol}` : ''}`
          }
          items={ownMovers}
          onSelect={goSector}
          sample={false}
          asOf={own.asOf}
          source={'weighted constituents'}
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
        )}
      </View>

      <MacroPanel iso2={country.iso} />

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
            // A sector the country has no coverage for shows NO number rather than borrowing the
            // US one — the same rule the constituent lists follow.
            // NEVER the US figure, and never the authored one: a country with no coverage shows
            // no number at all, matching the panel above.
            changePct: own.empty ? undefined : changeById.get(s.id),
          }))}
          onSelect={goSector}
        />
      </View>

      {/* THE SECURITIES THIS COUNTRY'S SECTOR LIST CANNOT SHOW. 1,290 equities have no sector yet,
          so they appear under no sector page — present in the universe and unreachable by browsing.
          A list that silently omits them is worse than one that offers a way in. */}
      <View className="mt-2">
        <DrillList
          items={[{
            key: 'other',
            title: 'Other',
            subtitle: `Securities in ${country.name} with no sector yet`,
          }]}
          onSelect={() =>
            router.push({
              pathname: '/other',
              params: { kind: 'no-sector', countryIso: country.iso },
            })
          }
        />
      </View>
    </Screen>
  );
}

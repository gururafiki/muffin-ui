import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, Segmented, Text } from '@/components/ui';
import { TimeSeriesChart } from '@/lib/agent/renderers/chart';
import { palette } from '@/theme/colors';
import { CallCard, openThreadRoute } from '@/features/agent-calls/call-card';
import { useTickerRuns } from '@/features/agent-calls/use-ticker-runs';
import { AGENTS } from '@/lib/agent/registry';
import { useInstrument } from '@/features/markets/api/use-instrument';
import { useSecurityFunds } from '@/features/markets/api/use-security-funds';
import { getCountryByIso } from '@/features/markets/taxonomy';
import {
  useInstrumentPrices,
  type ChartRange,
} from '@/features/markets/api/use-instrument-prices';
import { Freshness } from '@/features/markets/freshness';
import { formatMoney } from '@/features/markets/money';
import { PerformanceStrip } from '@/features/markets/performance-strip';
import { StockSkeleton } from '@/features/markets/stock-skeleton';
import { useFundamentals } from '@/features/markets/api/use-fundamentals';
import { useStatements } from '@/features/markets/api/use-statements';
import { SecurityRefreshButton } from '@/features/markets/security-refresh-button';
import { MarketStats } from '@/features/markets/market-stats';
import { MetricHistory } from '@/features/markets/metric-history';
import { ValuationHistory } from '@/features/markets/valuation-history';
import { CorporateActions } from '@/features/markets/corporate-actions';
import { NewsPanel } from '@/features/markets/news-panel';
import { assetTypeMeta, getSector, type AssetType } from '@/features/markets/taxonomy';

/** Stocks reachable from here: ticker-driven agents + the deep evaluation. */
const STOCK_AGENT_IDS = ['council', 'criteria_analysis', 'stock_evaluation'];

export default function StockScreen() {
  const params = useLocalSearchParams<{
    ticker: string;
    sector?: string;
    market?: string;
    country?: string;
    assetType?: string;
  }>();
  const router = useRouter();
  const symbol = (params.ticker ?? '').toUpperCase();
  const detail = useInstrument(symbol);
  const fundamentals = useFundamentals(symbol);
  const statements = useStatements(symbol);
  const inst = detail.instrument;
  const [range, setRange] = useState<ChartRange>('1y');
  const prices = useInstrumentPrices(symbol, range);
  const past = useTickerRuns(symbol);

  // Server data wins over the route params: a deep link carries whatever the
  // linking screen happened to know, while `market.instruments` is the record.
  const sector = getSector(inst?.sector_id ?? params.sector ?? '');
  const assetType = (inst?.asset_type ?? params.assetType) as AssetType | undefined;
  const asset = assetType ? assetTypeMeta(assetType) : undefined;
  const country = inst?.country ?? params.country;
  // The registry is keyed on ISO; the display name alone cannot route.
  const countryRoute = inst?.countryIso ? getCountryByIso(inst.countryIso)?.id : undefined;
  const funds = useSecurityFunds(inst?.securityId ?? undefined);

  const stockAgents = AGENTS.filter((a) => STOCK_AGENT_IDS.includes(a.id));

  const launch = (agentId: string) => {
    const extra: Record<string, string> = {};
    if (agentId === 'stock_evaluation') {
      extra.prompt = `Evaluate ${symbol} as a long-term holding. Cover the thesis, valuation and key risks.`;
    } else {
      extra.ticker = symbol;
      if (agentId === 'criteria_analysis') {
        if (params.sector) extra.sector = params.sector;
        if (params.market) extra.market = params.market;
      }
    }
    router.push({ pathname: '/agents/[assistantId]', params: { assistantId: agentId, ...extra } });
  };

  // The page rendered a bare symbol over blank space while the instrument loaded, which reads as
  // "no data for this ticker" rather than "still loading" — and the two look identical to someone
  // who has just tapped a row.
  if (detail.loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: symbol }} />
        <StockSkeleton />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: symbol }} />
      <Text variant="display" className="pt-4">
        {symbol}
      </Text>
      <View className="flex-row items-center justify-between">
        {inst?.name ? <Text variant="muted" className="flex-1">{inst.name}</Text> : <View className="flex-1" />}
        {/* Per-SYMBOL, not the whole universe: the bulk resources are budgeted for backlogs and
            would refuse on their TTL, and this is the page where a stale number is noticed. */}
        <SecurityRefreshButton symbol={symbol} />
      </View>

      {fundamentals.metrics.length > 0 ? (
        <Card className="mt-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="heading">Fundamentals</Text>
            <Freshness sample={false} asOf={fundamentals.asOf} source="yfinance" />
          </View>
          <View className="flex-row flex-wrap">
            {fundamentals.metrics.map((m) => (
              <View key={m.label} className="w-1/2 py-1.5 pr-2">
                <Text variant="muted" className="text-xs">{m.label}</Text>
                <Text variant="heading">{m.value}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {statements.periods.length > 0 ? (
        <Card className="mt-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="heading">Income statement</Text>
            {/* The ISO CODE, even though every figure below already carries a symbol: a symbol
                cannot disambiguate the seven currencies in this universe that print as "$". */}
            <Text variant="muted" className="text-xs">
              {statements.periods[0].currency ? `${statements.periods[0].currency} · ` : ''}yfinance
            </Text>
          </View>
          {statements.periods.map((p) => (
            <View
              key={p.period}
              className="gap-0.5 border-t border-frosting-100 pt-2 dark:border-night-surface-muted">
              <Text variant="muted" className="text-xs">{p.period}</Text>
              <View className="flex-row flex-wrap">
                {([
                  ['Revenue', p.revenue],
                  ['Gross profit', p.grossProfit],
                  ['Operating income', p.operatingIncome],
                  ['Net income', p.netIncome],
                ] as [string, number | null][])
                  // A line item this filer did not report is DROPPED, not dashed — filers report
                  // different sets, which is why the statements are stored as jsonb at all.
                  .filter((x): x is [string, number] => x[1] != null)
                  .map(([label, value]) => (
                    <View key={label} className="w-1/2 py-1 pr-2">
                      <Text variant="muted" className="text-xs">{label}</Text>
                      <Text variant="heading">{formatMoney(value, p.currency)}</Text>
                    </View>
                  ))}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {sector || country || params.market || asset || inst?.industry ? (
        <View className="mt-1 flex-row flex-wrap gap-2">
          {asset ? <Badge label={asset.name} tone="info" /> : null}
          {sector ? <Badge label={sector.name} tone="info" /> : null}
          {/* The provider's industry — the real sub-sector. */}
          {inst?.industry ? <Badge label={inst.industry} tone="info" /> : null}
          {/* CLICKABLE, because a country badge that is not is a dead end on the one screen where
              the next question is always "what else is from there?". Falls back to a plain badge
              when the ISO resolves to no registry entry — 180 securities are filed under offshore
              incorporation jurisdictions (Cayman, Bermuda, BVI) which have no country page. */}
          {country ? (
            countryRoute ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${country}`}
                onPress={() => router.push({ pathname: '/country/[countryId]', params: { countryId: countryRoute } })}
              >
                <Badge label={country} tone="info" />
              </Pressable>
            ) : (
              <Badge label={country} tone="info" />
            )
          ) : null}
          {params.market ? (
            <Badge label={params.market === 'developed' ? 'Developed' : 'Emerging'} tone="info" />
          ) : null}
        </View>
      ) : null}

      {/* THE FINANCIALS, AND THE MARKET DATA THAT FRAMES THEM. Both render nothing at all until
          the backlogs reach this security — an empty "Financials" heading reads as a broken page,
          while no section reads as a page that does not claim to have it. */}
      <ValuationHistory symbol={symbol} />
      <MetricHistory symbol={symbol} />
      <MarketStats securityId={inst?.securityId} />
      <CorporateActions securityId={inst?.securityId} currency={inst?.currency} />
      <NewsPanel symbol={symbol} />

      {/* WHO OWNS IT. The universe is built from fund holdings, so "which funds hold this" is not a
          nice-to-have — it is the provenance of every other number on the page. Each fund opens its
          own holdings, which is how a person gets from one company to its peers.

          Weights are the fund's OWN filed figures and are NOT renormalised: a fund's weights do not
          sum to 100 (EWT files 110.38), so presenting them as shares of a whole would be inventing
          a denominator the filing does not have. */}
      {funds.items.length > 0 ? (
        <Card className="mt-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="heading">Held by</Text>
            {funds.asOf ? (
              <Text variant="muted" className="text-xs">
                as filed {funds.asOf.toISOString().slice(0, 10)}
              </Text>
            ) : null}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {funds.items.map((f) => (
              <Pressable
                key={f.symbol}
                accessibilityRole="button"
                accessibilityLabel={`Open ${f.symbol} holdings`}
                onPress={() => router.push({ pathname: '/fund/[fundSymbol]', params: { fundSymbol: f.symbol } })}
              >
                <Badge
                  label={f.weightPct != null ? `${f.symbol} · ${f.weightPct.toFixed(2)}%` : f.symbol}
                  tone="info"
                />
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {detail.returns.length > 0 ? (
        <Card className="mt-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="heading">Performance</Text>
            <Freshness sample={false} asOf={detail.asOf} source={detail.source} />
          </View>
          <PerformanceStrip returns={detail.returns} />

          {/* Only rendered when there is actually a series — no empty chart frame. */}
          {prices.series ? (
            <View className="gap-2">
              <Segmented
                // FROM THE HOOK, not the full list: the long ranges appear only once this
                // security has weekly history, so the picker never offers a range that would
                // draw nothing.
                options={prices.ranges}
                value={range}
                onChange={setRange}
              />
              <TimeSeriesChart data={prices.series} />
            </View>
          ) : null}

          {inst?.market_cap ? (
            <Text variant="muted" className="text-xs">
              Market cap {formatMoney(inst.market_cap, inst.currency)}
            </Text>
          ) : null}
        </Card>
      ) : detail.found && inst?.priced === false ? (
        // Cash and bond yields have no price return — say so rather than showing 0%.
        <Text variant="muted" className="mt-3">
          No price return for this instrument.
        </Text>
      ) : null}

      {/* Past work on this name, before the launchers — what has already been
          concluded is more useful than starting again. Absent when there is none:
          an empty "no runs yet" panel on every unanalysed ticker is noise. */}
      {past.runs.length > 0 ? (
        <>
          <Text variant="label" className="mt-5">
            Past analysis · {symbol}
          </Text>
          <View className="mt-2 gap-2.5">
            {past.runs.slice(0, 5).map((thread) => (
              <CallCard
                key={thread.thread_id}
                thread={thread}
                onOpen={(t) => openThreadRoute(router, t)}
              />
            ))}
          </View>
        </>
      ) : null}

      <Text variant="muted" className="mt-4">
        {past.runs.length > 0 ? 'Or run another agent.' : 'Run an analysis agent for this stock.'}
      </Text>

      <View className="mt-4 gap-3">
        {stockAgents.map((agent) => (
          <Pressable key={agent.id} onPress={() => launch(agent.id)} className="active:opacity-80">
            <Card tone="sticker" className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                <Icon name={agent.icon} size={26} color={palette.frosting[600]} />
              </View>
              <View className="flex-1">
                <Text variant="heading">{agent.title}</Text>
                <Text variant="muted">{agent.tagline}</Text>
              </View>
              <Icon name="chevron-right" size={20} color={palette.frosting[300]} weight="bold" />
            </Card>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

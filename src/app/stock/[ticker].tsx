import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, Segmented, Text } from '@/components/ui';
import { TimeSeriesChart } from '@/lib/agent/renderers/chart';
import { palette } from '@/theme/colors';
import { AGENTS } from '@/lib/agent/registry';
import { useInstrument } from '@/features/markets/api/use-instrument';
import {
  CHART_RANGES,
  useInstrumentPrices,
  type ChartRange,
} from '@/features/markets/api/use-instrument-prices';
import { Freshness } from '@/features/markets/freshness';
import { PerformanceStrip } from '@/features/markets/performance-strip';
import { assetTypeMeta, getSector, type AssetType } from '@/features/markets/taxonomy';

/** Stocks reachable from here: ticker-driven agents + the deep evaluation. */
const STOCK_AGENT_IDS = ['council', 'criteria_analysis', 'stock_evaluation'];

/** 4.57e12 -> "$4.57T". Market caps span nine orders of magnitude here. */
function formatCap(v: number): string {
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
  for (const [scale, suffix] of units) {
    if (v >= scale) return `$${(v / scale).toFixed(2)}${suffix}`;
  }
  return `$${v.toFixed(0)}`;
}

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
  const inst = detail.instrument;
  const [range, setRange] = useState<ChartRange>('1y');
  const prices = useInstrumentPrices(symbol, range);

  // Server data wins over the route params: a deep link carries whatever the
  // linking screen happened to know, while `market.instruments` is the record.
  const sector = getSector(inst?.sector_id ?? params.sector ?? '');
  const assetType = (inst?.asset_type ?? params.assetType) as AssetType | undefined;
  const asset = assetType ? assetTypeMeta(assetType) : undefined;
  const country = inst?.country ?? params.country;

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

  return (
    <Screen>
      <Stack.Screen options={{ title: symbol }} />
      <Text variant="display" className="pt-4">
        {symbol}
      </Text>
      {inst?.name ? <Text variant="muted">{inst.name}</Text> : null}

      {sector || country || params.market || asset || inst?.industry ? (
        <View className="mt-1 flex-row flex-wrap gap-2">
          {asset ? <Badge label={asset.name} tone="info" /> : null}
          {sector ? <Badge label={sector.name} tone="info" /> : null}
          {/* The provider's industry — the real sub-sector. */}
          {inst?.industry ? <Badge label={inst.industry} tone="info" /> : null}
          {country ? <Badge label={country} tone="info" /> : null}
          {params.market ? (
            <Badge label={params.market === 'developed' ? 'Developed' : 'Emerging'} tone="info" />
          ) : null}
        </View>
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
                options={CHART_RANGES.map((r) => ({ id: r.id, label: r.label }))}
                value={range}
                onChange={setRange}
              />
              <TimeSeriesChart data={prices.series} />
            </View>
          ) : null}

          {inst?.market_cap ? (
            <Text variant="muted" className="text-xs">
              Market cap {formatCap(inst.market_cap)}
            </Text>
          ) : null}
        </Card>
      ) : detail.found && inst?.priced === false ? (
        // Cash and bond yields have no price return — say so rather than showing 0%.
        <Text variant="muted" className="mt-3">
          No price return for this instrument.
        </Text>
      ) : null}

      <Text variant="muted" className="mt-4">
        Run an analysis agent for this stock.
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

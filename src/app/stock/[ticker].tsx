import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { AGENTS } from '@/lib/agent/registry';
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
  const sector = params.sector ? getSector(params.sector) : undefined;
  const asset = params.assetType ? assetTypeMeta(params.assetType as AssetType) : undefined;

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

      {sector || params.country || params.market || asset ? (
        <View className="mt-1 flex-row flex-wrap gap-2">
          {asset ? <Badge label={asset.name} tone="info" /> : null}
          {sector ? <Badge label={sector.name} tone="info" /> : null}
          {params.country ? <Badge label={params.country} tone="info" /> : null}
          {params.market ? (
            <Badge label={params.market === 'developed' ? 'Developed' : 'Emerging'} tone="info" />
          ) : null}
        </View>
      ) : null}

      <Text variant="muted" className="mt-2">
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

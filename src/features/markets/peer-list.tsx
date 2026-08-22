/**
 * Companies of a similar size in the same sector.
 *
 * THE HEADING SAYS WHAT IT IS, and that is deliberate. These are not curated peers — the list is
 * sector plus market-cap proximity, which is also what a vendor's "peers" endpoint returns, and
 * calling it "Peers" would imply an editorial judgement nobody made. A reader who knows the list is
 * mechanical can discount it; one who thinks it was chosen cannot.
 *
 * SIZES ARE STATED IN USD, explicitly. `security.market_cap` is denominated in each company's own
 * currency, so the view converts before ranking — and the label has to say so, or a reader compares
 * a yen figure to a dollar one and the conversion is invisible.
 */
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, Text } from '@/components/ui';

import { usePeers } from './api/use-peers';
import { formatMoney } from './money';

export function PeerList({ securityId }: { securityId: string | null | undefined }) {
  const router = useRouter();
  const { peers, loading, empty } = usePeers(securityId);

  // A security with no sector, or the only company in one, has no peers — no section rather than
  // an empty one, the rule every panel here follows.
  if (loading || empty) return null;

  return (
    <>
      <View className="mt-5">
        <Text variant="label">Similar size in this sector</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {peers.map((p) => {
          const row = (
            <View className="flex-row items-baseline justify-between">
              <Text variant="body" className="flex-1 pr-3">
                {p.name ?? p.symbol ?? 'Unknown'}
              </Text>
              <Text variant="muted">
                {/* USD is stated, not implied: the view converted to make the ranking meaningful
                    and hiding that invites a reader to compare it with a native-currency figure
                    elsewhere on the page. */}
                {p.marketCapUsd === null ? '' : formatMoney(p.marketCapUsd, 'USD')}
              </Text>
            </View>
          );
          // NOT TAPPABLE WITHOUT A SYMBOL. `/stock/[ticker]` is keyed on one, and a row that looks
          // like a link and navigates nowhere is worse than a row that plainly is not one.
          if (!p.symbol) return <View key={p.id}>{row}</View>;
          return (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/stock/${encodeURIComponent(p.symbol as string)}`)}
              accessibilityRole="button"
              accessibilityLabel={p.name ?? p.symbol}
            >
              {row}
            </Pressable>
          );
        })}
        <Text variant="muted">
          Chosen by sector and market value, not curated. Figures in USD.
        </Text>
      </Card>
    </>
  );
}

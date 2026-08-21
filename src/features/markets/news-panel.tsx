/**
 * Recent articles the provider associated with this security.
 *
 * THE HEADING SAYS "ASSOCIATED", AND THAT WORD IS load-bearing. yfinance returned a Waymo story
 * under AAPL. We did not choose these articles and cannot verify the association, so presenting
 * them as "news about this company" would assert an editorial judgement that is not ours. Naming
 * the provider is the honest render — the same rule that badges unlive numbers SAMPLE.
 */
import { Linking, Pressable, View } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useSecurityNews } from './api/use-security-news';

function age(published: string): string {
  const days = Math.floor((Date.now() - new Date(published).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function NewsPanel({ symbol }: { symbol: string | undefined }) {
  const { articles, loading, empty } = useSecurityNews(symbol);

  // Retention is 90 days, so "no recent news" is an ordinary state for most securities — and it
  // renders as no section rather than an empty one.
  if (loading || empty) return null;

  return (
    <>
      <View className="mt-5">
        <Text variant="label">In the news</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-3">
        {articles.map((a) => (
          <Pressable
            key={a.url}
            onPress={() => Linking.openURL(a.url)}
            accessibilityRole="link"
            accessibilityLabel={a.title}
          >
            <Text variant="body">{a.title}</Text>
            <Text variant="muted">
              {[a.source, age(a.publishedAt)].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        ))}
        {/* Provenance, not decoration: the association is the provider's, not ours. */}
        <Text variant="muted">
          Articles associated with this symbol by the data provider, not selected by muffin.
        </Text>
      </Card>
    </>
  );
}

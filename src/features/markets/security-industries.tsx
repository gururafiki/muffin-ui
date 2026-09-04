/**
 * How this company is classified, and by whom.
 *
 * THE PAGE SHOWS ONE LABEL AND SEVERAL ARE TRUE. `security_current` picks the highest-priority
 * source, which is right for a screener and hides the most interesting thing here: the
 * segment-derived rows apportion a company across sectors from its own filed business lines, so
 * Amazon is 61.6% consumer discretionary BY REVENUE and 57.0% information technology BY PROFIT.
 *
 * A WEIGHT AND A LABEL ARE DIFFERENT CLAIMS and are rendered differently. yfinance says "Internet
 * Retail" — a name, no weight. `segment-revenue` says "62% of what this company sells is consumer
 * discretionary" — a measurement, with a bar. Showing the second as a plain chip would throw away
 * the only part that is quantitative.
 *
 * This section does not change the pick. The screener, every sector page and the markets donut all
 * read `security_current.industry`, and a second opinion in a card is not a reason to move them.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { chartColors } from '@/theme/colors';

import { useIndustries } from './api/use-industries';

/** `data_source.name` is authoritative but long; these are the reader-facing short forms. */
const SOURCE_LABEL: Record<string, string> = {
  'sec-nport': 'Fund filing',
  'sec-segments': 'Segment disclosure',
  'segment-revenue': 'Its own revenue',
  'segment-profit': 'Its own profit',
  yfinance: 'yfinance',
  wikidata: 'Wikidata',
  sic: 'SEC SIC code',
  authored: 'Curated',
};

export function SecurityIndustries({ securityId }: { securityId: string | null | undefined }) {
  const { groups, loading, empty } = useIndustries(securityId);

  if (loading || empty) return null;

  return (
    <>
      <View className="mt-5">
        <Text variant="label">How it&rsquo;s classified</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-3">
        {groups.map((g) => (
          <View key={g.sourceCode} className="gap-1.5">
            <View className="flex-row items-baseline gap-2">
              <Text variant="body" className="font-semibold">
                {SOURCE_LABEL[g.sourceCode] ?? g.sourceCode}
              </Text>
              {g.authoritative ? <Text variant="muted">· shown above</Text> : null}
            </View>

            {g.rows.map((r) => (
              <View key={`${r.code}:${r.level}`} className="gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text variant="muted" className="shrink">
                    {r.parentName ? `${r.parentName} · ` : ''}
                    {r.name}
                  </Text>
                  {r.weight !== null ? (
                    <Text variant="muted" className="shrink-0">
                      {(r.weight * 100).toFixed(1)}%
                    </Text>
                  ) : null}
                </View>
                {/* Only a weighted row gets a bar. A bar under a label with no weight would invent
                    a precision the source never claimed. */}
                {r.weight !== null ? (
                  <View className="h-1.5 overflow-hidden rounded-pill bg-crust dark:bg-night-surface-muted">
                    <View
                      style={{
                        width: `${Math.max(1, Math.min(100, r.weight * 100))}%`,
                        backgroundColor: chartColors.sector[0],
                        height: '100%',
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ))}
        <Text variant="muted" className="text-[11px]">
          Sources disagree, and each is right about a different question. A weighted row is derived
          from the company&rsquo;s own filed business lines.
        </Text>
      </Card>
    </>
  );
}

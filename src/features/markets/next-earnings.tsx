/**
 * When this company reports, and what the street expects.
 *
 * THE TENSE IS THE POINT. `upcoming` comes from the server, which chooses the next scheduled report
 * where there is one and the most recent past one otherwise. Rendering "Reports" above a date that
 * has passed would present history as a forecast, and the consensus figure beside it would read as
 * something still to be beaten.
 *
 * The date is formatted from its PARTS, not through `new Date(...)`. A bare `2026-08-26` parses as
 * UTC midnight, so a reader west of Greenwich sees the 25th — an earnings date off by one is a
 * different trading day, which is the only thing anyone uses this for.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useNextEarnings } from './api/use-next-earnings';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-26` -> `26 Aug 2026`, without a timezone anywhere near it. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((p) => Number(p));
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

/** "after-hours" -> "after hours"; the provider's hyphenation is not English. */
function formatTime(t: string): string {
  return t.replace(/-/g, ' ');
}

export function NextEarnings({ securityId }: { securityId: string | null | undefined }) {
  const { earnings, loading, empty } = useNextEarnings(securityId);

  // The calendar is US-listed, so most securities have no row at all. No section rather than an
  // empty one — the rule every panel here follows.
  if (loading || empty || !earnings) return null;

  const when = [formatDate(earnings.reportDate), earnings.reportingTime ? formatTime(earnings.reportingTime) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <View className="mt-5">
        <Text variant="label">{earnings.upcoming ? 'Next earnings' : 'Last earnings'}</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        <View className="flex-row items-baseline justify-between">
          <Text variant="body">{when}</Text>
          {earnings.periodEnding ? (
            <Text variant="muted">{`for ${earnings.periodEnding}`}</Text>
          ) : null}
        </View>

        {earnings.consensus !== null ? (
          <View className="flex-row items-baseline justify-between">
            <Text variant="muted">
              {/* "Consensus" only while it is still ahead: once the date has passed the number is
                  what was expected, not what anyone now expects. */}
              {earnings.upcoming ? 'Consensus EPS' : 'Was expected'}
              {earnings.estimates ? ` · ${earnings.estimates} analysts` : ''}
            </Text>
            <Text variant="body">{earnings.consensus.toFixed(2)}</Text>
          </View>
        ) : null}

        {earnings.previous !== null ? (
          <View className="flex-row items-baseline justify-between">
            <Text variant="muted">Same quarter last year</Text>
            <Text variant="muted">{earnings.previous.toFixed(2)}</Text>
          </View>
        ) : null}
      </Card>
    </>
  );
}

/**
 * What analysts have actually DONE to this stock recently — the events behind the consensus.
 *
 * NO VERDICT IS OFFERED, for the same reason `InsiderActivity` offers none. Aggregating these into
 * "analysts are bullish" would be a second, worse answer to a question `security_estimate` already
 * answers properly with a consensus over every covering analyst — and this table is a rolling
 * window of the most recent actions, so a tally of it would be a sample masquerading as a survey.
 * The section reports who moved, when, and which way, and stops.
 *
 * IT IS OPINION, AND SAYS SO. Every other section on this page is derived from a filing; this one
 * is what a broker published. The footnote is not decoration — without it the numbers read with the
 * same authority as reported revenue.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';

import { ratingFor, targetFor } from './analyst-action-parts';
import { useAnalystActions } from './api/use-analyst-actions';

/** `2026-09-01` -> `1 Sep 2026`. The provider sends a date, never a time. */
function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function AnalystActions({ securityId }: { securityId: string | null | undefined }) {
  const { actions, loading, empty } = useAnalystActions(securityId);

  // finviz covers US listings only, so most of the universe has nothing here. No section rather
  // than an empty one.
  if (loading || empty || actions.length === 0) return null;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Analyst actions</Text>
        <Text variant="muted">most recent</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-3">
        {actions.map((a) => {
          // USD IS PASSED EXPLICITLY, NOT DEFAULTED. `market.pending_price_targets` is scoped to
          // securities with a US listing and finviz quotes that line, so the target is in dollars
          // by construction — which is a reason, where `$` as a fallback would be the Alibaba bug.
          const target = targetFor(a, 'USD');
          const rating = ratingFor(a);
          return (
            <View key={`${a.publishedDate}|${a.analystCompany}`} className="gap-0.5">
              <View className="flex-row items-baseline justify-between gap-3">
                <Text variant="body" className="flex-1">
                  {a.analystCompany}
                </Text>
                {/* The action itself — Upgrade / Downgrade / Reiterated / Initiated / Resumed. */}
                {a.status ? <Text variant="muted">{a.status}</Text> : null}
              </View>
              <View className="flex-row items-baseline justify-between gap-3">
                <Text variant="muted">{formatDay(a.publishedDate)}</Text>
                {/* Absent entirely when the analyst published no number — 15 of 160 measured rows.
                    A dash here would read as a figure we failed to fetch. */}
                {target ? <Text variant="body">{target.text}</Text> : null}
              </View>
              {rating ? <Text variant="muted">{rating}</Text> : null}
            </View>
          );
        })}
        <Text variant="muted">
          Published analyst opinion, not company disclosure. US-listed coverage only.
        </Text>
      </Card>
    </>
  );
}

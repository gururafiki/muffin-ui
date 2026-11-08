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

/** `2026-09-01` -> `1 Sep 2026`. The day is shown, not the time: finviz's rows have none. */
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

  // Yahoo states analyst history mostly for US listings, so most of the universe has nothing here.
  // No section rather than an empty one.
  if (loading || empty || actions.length === 0) return null;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Analyst actions</Text>
        <Text variant="muted">most recent</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-3">
        {actions.map((a) => {
          // EACH ROW'S OWN CURRENCY: a target is in the quote's unit, and with none the figure is
          // left unlabelled rather than dollar-signed, which would be the Alibaba bug.
          const target = targetFor(a, a.currency);
          const rating = ratingFor(a);
          return (
            <View key={`${a.publishedAt}|${a.analystCompany}`} className="gap-0.5">
              <View className="flex-row items-baseline justify-between gap-3">
                <Text variant="body" className="flex-1">
                  {a.analystCompany}
                </Text>
                {/* The action itself: Upgrade, Downgrade, Maintains, Reiterated, Initiated or Resumed. */}
                {a.status ? <Text variant="muted">{a.status}</Text> : null}
              </View>
              <View className="flex-row items-baseline justify-between gap-3">
                <Text variant="muted">{formatDay(a.publishedDate)}</Text>
                {/* Absent entirely when the analyst published no number (22 of AAPL's 971 actions).
                    A dash here would read as a figure we failed to fetch. */}
                {target ? <Text variant="body">{target.text}</Text> : null}
              </View>
              {rating ? <Text variant="muted">{rating}</Text> : null}
            </View>
          );
        })}
        <Text variant="muted">
          Published analyst opinion, not company disclosure. Coverage is mostly US-listed companies.
        </Text>
      </Card>
    </>
  );
}

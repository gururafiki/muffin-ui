/**
 * When this company reports, what the street expects, and how its last quarters went.
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
import { palette } from '@/theme/colors';

import { type EarningsQuarter, useEarningsHistory, useNextEarnings } from './api/use-next-earnings';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-26` -> `26 Aug 2026`, without a timezone anywhere near it. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((p) => Number(p));
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

/**
 * "after-hours" -> "after hours"; the provider's hyphenation is not English.
 *
 * AND `not-supplied` IS AN ABSENCE WEARING A VALUE. nasdaq sends it for companies that have not
 * said whether they report before or after the bell — measured on live rows — and rendering
 * "26 Aug 2026 · not supplied" tells the reader nothing while looking like it means something.
 * Returns null so the caller drops it, exactly as it drops a missing field.
 */
function formatTime(t: string): string | null {
  if (/^not[-\s]?supplied$/i.test(t.trim())) return null;
  return t.replace(/-/g, ' ');
}

/** `2026-06-30` -> `Jun 2026`: the quarter by the month it ended, as both sources date it. */
function quarterLabel(iso: string): string {
  const [y, m] = iso.split('-').map((p) => Number(p));
  if (!y || !m) return iso;
  return `${MONTHS[m - 1] ?? ''} ${y}`;
}

/** Whose figures these are. A code we do not know is shown as it is rather than dropped. */
const SOURCES: Record<string, string> = { nasdaq: 'Nasdaq', yfinance: 'Yahoo Finance' };

/** One quarter: the reported EPS, the estimate before it, and how far it beat or missed. */
function QuarterRow({ quarter }: { quarter: EarningsQuarter }) {
  const { actual, estimate, surprisePct, beat } = quarter;
  const color = beat === null ? palette.inkMuted : beat ? palette.bullish : palette.bearish;
  const verdict =
    beat === null
      ? null
      : `${beat ? 'Beat' : 'Missed'}${surprisePct === null ? '' : ` ${Math.abs(surprisePct).toFixed(1)}%`}`;
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text variant="muted" className="w-20">
        {quarterLabel(quarter.periodEnding)}
      </Text>
      <Text variant="body" className="flex-1 tabular-nums">
        {actual === null ? '—' : actual.toFixed(2)}
        {estimate === null ? '' : (
          <Text variant="muted">{` vs ${estimate.toFixed(2)} est.`}</Text>
        )}
      </Text>
      {verdict ? (
        <Text className="font-semibold text-sm tabular-nums" style={{ color }}>
          {verdict}
        </Text>
      ) : (
        <Text variant="muted">no estimate</Text>
      )}
    </View>
  );
}

export function NextEarnings({ securityId }: { securityId: string | null | undefined }) {
  const { earnings, loading } = useNextEarnings(securityId);
  const { quarters, loading: historyLoading } = useEarningsHistory(securityId);

  // A company may have a date and no history, history and no date, or neither. No section rather
  // than an empty one — the rule every panel here follows.
  if (loading || historyLoading) return null;
  if (!earnings && quarters.length === 0) return null;

  // HOW THE LAST ONE WENT, from the newest quarter the history holds.
  const last = quarters[0] ?? null;

  return (
    <>
      {earnings ? <DateCard earnings={earnings} last={last} /> : null}
      {quarters.length > 0 ? <RecentQuarters quarters={quarters} /> : null}
    </>
  );
}

function RecentQuarters({ quarters }: { quarters: EarningsQuarter[] }) {
  const sources = [...new Set(quarters.map((q) => SOURCES[q.source] ?? q.source))];
  return (
    <>
      <View className="mt-5">
        <Text variant="label">Recent quarters</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        <Text variant="muted">EPS reported, against the estimate before it</Text>
        {quarters.map((q) => (
          <QuarterRow key={q.periodEnding} quarter={q} />
        ))}
        <Text variant="muted" className="text-xs">{`Source: ${sources.join(', ')}`}</Text>
      </Card>
    </>
  );
}

function DateCard({
  earnings,
  last,
}: {
  earnings: NonNullable<ReturnType<typeof useNextEarnings>['earnings']>;
  last: EarningsQuarter | null;
}) {
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

        {/* HOW THE LAST ONE WENT. Derived from the actual EPS and the consensus that preceded it,
            both already stored — a company that has just beaten or missed is the context a reader
            brings to the next date. Shown even on an UPCOMING report, because that is precisely
            when the previous quarter's result is the useful thing to know. */}
        {last && last.actual !== null && last.estimate !== null && last.beat !== null ? (
          <View className="flex-row items-baseline justify-between">
            <Text variant="muted">
              {last.beat ? 'Last quarter beat by' : 'Last quarter missed by'}
            </Text>
            <Text variant="body">
              {last.surprisePct === null
                ? `${Math.abs(last.actual - last.estimate).toFixed(2)}`
                : `${Math.abs(last.surprisePct).toFixed(1)}%`}
            </Text>
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

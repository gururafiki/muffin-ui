import { View } from 'react-native';

import type { IconName } from '@/components/icons';
import { Badge, Card, Collapsible, Text, type Signal } from '@/components/ui';
import { palette } from '@/theme/colors';
import { Markdown } from './markdown';

/** Map a free-text signal/rating to a tone. */
export function toneForSignal(signal?: string): Signal {
  const v = (signal ?? '').toLowerCase();
  if (/strong[_ ]?buy|buy|bull|outperform|positive|accumulate|overweight/.test(v)) return 'bullish';
  if (/strong[_ ]?sell|sell|bear|underperform|negative|reduce|underweight/.test(v)) return 'bearish';
  return 'neutral';
}

const toneColor: Record<Signal, string> = {
  bullish: palette.bullish,
  bearish: palette.bearish,
  neutral: palette.neutral,
  info: palette.frosting[500],
};

/** A 0..1 confidence/conviction meter. */
export function ConfidenceBar({ value, label = 'Confidence', tone = 'info' }: { value: number; label?: string; tone?: Signal }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View className="gap-1">
      <View className="flex-row justify-between">
        <Text variant="muted" className="text-xs uppercase tracking-wide">{label}</Text>
        <Text variant="muted" className="text-xs">{Math.round(pct)}%</Text>
      </View>
      <View className="h-2 overflow-hidden rounded-pill bg-frosting-100 dark:bg-night-surface-muted">
        <View style={{ width: `${pct}%`, backgroundColor: toneColor[tone] }} className="h-full rounded-pill" />
      </View>
    </View>
  );
}

/** A signed score bar (e.g. a criterion score from -max..max), centred at zero. */
export function ScoreBar({ value, max = 5, signal }: { value: number; max?: number; signal?: string }) {
  const tone = toneForSignal(signal);
  const clamped = Math.max(-max, Math.min(max, value));
  const half = Math.abs(clamped) / max / 2; // 0..0.5
  const left = clamped >= 0 ? 0.5 : 0.5 - half;
  return (
    <View className="h-2 flex-row overflow-hidden rounded-pill bg-frosting-100 dark:bg-night-surface-muted">
      <View style={{ width: `${left * 100}%` }} />
      <View style={{ width: `${half * 100}%`, backgroundColor: toneColor[tone] }} className="h-full" />
    </View>
  );
}

/** A bold verdict header: a big signal pill + optional conviction + summary. */
export function Verdict({
  signal,
  confidence,
  summary,
  badge,
}: {
  signal?: string;
  confidence?: number;
  summary?: string;
  badge?: string;
}) {
  const tone = toneForSignal(signal);
  return (
    <Card tone="sticker" className="gap-3">
      <View className="flex-row items-center gap-3">
        <View
          className="rounded-pill px-4 py-2"
          style={{ backgroundColor: toneColor[tone] + '22', borderWidth: 2, borderColor: toneColor[tone] + '55' }}>
          <Text className="font-display text-xl" style={{ color: toneColor[tone] }}>
            {(signal ?? badge ?? '—').toUpperCase()}
          </Text>
        </View>
        {typeof confidence === 'number' ? (
          <View className="flex-1">
            <ConfidenceBar value={confidence} label="Conviction" tone={tone} />
          </View>
        ) : null}
      </View>
      {summary ? <Markdown value={summary} /> : null}
    </Card>
  );
}

/** A collapsible markdown report section with an icon header. */
export function ReportSection({
  title,
  icon,
  markdown,
  defaultOpen,
}: {
  title: string;
  icon?: IconName;
  markdown?: string;
  defaultOpen?: boolean;
}) {
  if (!markdown || !markdown.trim()) return null;
  return (
    <Card tone="muted">
      <Collapsible title={title} icon={icon} defaultOpen={defaultOpen}>
        <Markdown value={markdown} />
      </Collapsible>
    </Card>
  );
}

/** A small labelled tag row (e.g. sector / type chips). */
export function TagRow({ tags }: { tags: (string | undefined)[] }) {
  const items = tags.filter((t): t is string => !!t);
  if (items.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((t, i) => (
        <Badge key={i} label={t} tone="info" />
      ))}
    </View>
  );
}

export { toneColor };

/**
 * Field-level presenters — the vocabulary every structured payload is rendered with.
 *
 * These exist because a Pydantic model's *meaning* is legible from its field names and
 * value shapes, and rendering that meaning is what separates a report from a data dump.
 * `confidence: 0.9` is a gauge, not the text "0.9"; `signal: "strong_buy"` is a toned
 * pill; `weight: 0.208` is a share of a whole; `raw_return_pct: 5.3` is a signed delta;
 * `limitations: [...]` is a caveat list. The old renderer printed all five identically as
 * a label above a value, which is why a classification read like a database row.
 *
 * Deliberately small and composable: `semantic.tsx` picks a presenter per field for ANY
 * payload (including graphs written later), and the hand-designed cards reuse the same
 * pieces so the two layers cannot look like different products.
 */
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Badge, Text, type Signal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { toneColor, toneForSignal } from './widgets';

/** A 0..1 ratio drawn as a filled track with its percentage. Compact enough to sit
 * inline in a row, unlike `ConfidenceBar` which owns a full-width block. */
export function Gauge({
  value,
  tone = 'info',
  width = 64,
}: {
  value: number;
  tone?: Signal;
  width?: number;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View className="flex-row items-center gap-2">
      <View
        style={{ width }}
        className="h-1.5 overflow-hidden rounded-pill bg-frosting-100 dark:bg-night-surface-muted">
        <View style={{ width: `${pct}%`, backgroundColor: toneColor[tone] }} className="h-full rounded-pill" />
      </View>
      <Text variant="body" className="text-sm tabular-nums">
        {Math.round(pct)}%
      </Text>
    </View>
  );
}

/** A share-of-whole bar — used for criterion weights, where the interesting thing is
 * how much of the scorecard this one line owns. */
export function WeightBar({ value, width = 44 }: { value: number; width?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width }} className="h-1 overflow-hidden rounded-pill bg-frosting-100 dark:bg-night-surface-muted">
        <View style={{ width: `${pct}%` }} className="h-full rounded-pill bg-frosting-400" />
      </View>
      <Text variant="muted" className="text-[11px] tabular-nums">
        {pct < 10 ? pct.toFixed(1) : Math.round(pct)}%
      </Text>
    </View>
  );
}

/** A signed percentage with direction and colour — returns, alpha, drawdowns. */
export function DeltaValue({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const up = value > 0;
  const flat = value === 0;
  const color = flat ? palette.inkMuted : up ? palette.bullish : palette.bearish;
  return (
    <View className="flex-row items-center gap-1">
      {!flat ? (
        <Icon name={up ? 'trend-up' : 'trend-down'} size={13} color={color} weight="bold" />
      ) : null}
      <Text className="font-semibold text-sm tabular-nums" style={{ color }}>
        {up ? '+' : ''}
        {Number.isInteger(value) ? value : value.toFixed(2)}
        {suffix}
      </Text>
    </View>
  );
}

/** A money-ish figure. No currency symbol: the graphs report in the quote currency and
 * never say which, so inventing one would be a lie. */
export function MoneyValue({ value }: { value: number }) {
  const abs = Math.abs(value);
  const text =
    abs >= 1_000_000_000
      ? `${(value / 1_000_000_000).toFixed(2)}B`
      : abs >= 1_000_000
        ? `${(value / 1_000_000).toFixed(2)}M`
        : abs >= 1000
          ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
          : value.toFixed(2);
  return (
    <Text variant="body" className="font-semibold text-sm tabular-nums">
      {text}
    </Text>
  );
}

/** One label→value line. The label stays quiet and fixed-width-ish so a stack of them
 * scans as a table without being one. */
export function MetricRow({
  label,
  children,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <View className="flex-row items-center gap-2 py-0.5">
      {icon ? <Icon name={icon} size={13} color={palette.frosting[400]} /> : null}
      <Text variant="muted" className="min-w-0 flex-1 text-xs">
        {label}
      </Text>
      {children}
    </View>
  );
}

/** Short strings as chips; anything long falls back to a bulleted list, because a chip
 * that wraps to three lines is just a bullet with extra borders. */
export function ChipList({ items, tone = 'info' }: { items: string[]; tone?: Signal }) {
  const values = items.filter((s) => typeof s === 'string' && s.trim());
  if (values.length === 0) return null;
  if (values.every((s) => s.length <= 32)) {
    return (
      <View className="flex-row flex-wrap gap-1.5">
        {values.map((s, i) => (
          <Badge key={i} label={s} tone={tone} />
        ))}
      </View>
    );
  }
  return (
    <View className="gap-1">
      {values.map((s, i) => (
        <View key={i} className="flex-row gap-2">
          <Text variant="muted" className="text-sm">
            •
          </Text>
          <Text variant="body" className="min-w-0 flex-1 text-sm">
            {s}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A caveat list — limitations, risks, missing information. Iconed and toned so it reads
 * as a warning rather than as more content. */
export function CaveatList({
  items,
  icon = 'warning',
  tone = palette.butter[600],
}: {
  items: string[];
  icon?: IconName;
  tone?: string;
}) {
  const values = items.filter((s) => typeof s === 'string' && s.trim());
  if (values.length === 0) return null;
  return (
    <View className="gap-1.5">
      {values.map((s, i) => (
        <View key={i} className="flex-row gap-2">
          <View className="pt-0.5">
            <Icon name={icon} size={13} color={tone} />
          </View>
          <Text variant="muted" className="min-w-0 flex-1 text-sm">
            {s}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A checklist of things that were confirmed — evidence, catalysts, findings. */
export function CheckList({ items, tone = palette.leaf[500] }: { items: string[]; tone?: string }) {
  const values = items.filter((s) => typeof s === 'string' && s.trim());
  if (values.length === 0) return null;
  return (
    <View className="gap-1.5">
      {values.map((s, i) => (
        <View key={i} className="flex-row gap-2">
          <View className="pt-0.5">
            <Icon name="check" size={13} color={tone} weight="bold" />
          </View>
          <Text variant="body" className="min-w-0 flex-1 text-sm">
            {s}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A large headline figure with a caption — the one number a card is about. */
export function HeadlineStat({
  value,
  caption,
  tone,
}: {
  value: string;
  caption: string;
  tone?: Signal;
}) {
  return (
    <View className="gap-0.5">
      <Text
        className={cn('font-display text-2xl')}
        style={tone ? { color: toneColor[tone] } : undefined}>
        {value}
      </Text>
      <Text variant="muted" className="text-[11px] uppercase tracking-wide">
        {caption}
      </Text>
    </View>
  );
}

/** A signal/rating pill sized for a card header. */
export function SignalPill({ signal, size = 'md' }: { signal: string; size?: 'sm' | 'md' | 'lg' }) {
  const tone = toneForSignal(signal);
  const text = signal.replace(/_/g, ' ').toUpperCase();
  const cls = size === 'lg' ? 'px-4 py-2 text-xl' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-base';
  return (
    <View
      className={cn('self-start rounded-pill', cls)}
      style={{ backgroundColor: `${toneColor[tone]}22`, borderWidth: 2, borderColor: `${toneColor[tone]}55` }}>
      <Text className={cn('font-display', cls.split(' ').pop())} style={{ color: toneColor[tone] }}>
        {text}
      </Text>
    </View>
  );
}

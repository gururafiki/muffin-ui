/**
 * The macro panel on a country page: inflation, unemployment, the 10-year yield.
 *
 * Renders NOTHING when the country has no series. 14 countries are covered against 45 modelled, so
 * the absent case is the common one — and an empty panel headed "Economy" reads as a broken
 * feature, while no panel reads as a page that does not claim to have it. The same reason a
 * security with no performance row shows no number rather than a zero.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useCountryMacro, type MacroSeries } from './api/use-macro';

/** Order the categories read in, rather than alphabetically by code. */
const CATEGORY_ORDER = ['inflation', 'labour', 'rates', 'growth'] as const;

function rank(s: MacroSeries): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(s.category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/**
 * A percent is rendered with its sign only where the sign carries meaning. Inflation of 2.3% and a
 * yield of 4.47% are levels, not changes — prefixing "+" would read as a move.
 */
function formatValue(s: MacroSeries): string {
  if (s.unit === 'percent') return `${s.value.toFixed(2)}%`;
  // An index level or a price: no unit claim we can make safely, so no unit is printed. Guessing
  // dollars is how the currency bug started.
  return s.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function ageLabel(asOf: Date): string {
  const days = Math.floor((Date.now() - asOf.getTime()) / 86_400_000);
  if (days <= 1) return 'today';
  if (days < 45) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function MacroPanel({ iso2 }: { iso2: string | undefined }) {
  const macro = useCountryMacro(iso2);

  // No panel at all — neither while loading (it would flash) nor when the country has no series.
  if (macro.loading || macro.empty || macro.items.length === 0) return null;

  const rows = [...macro.items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Economy</Text>
        {/* THE AGE TRAVELS WITH THE NUMBER. Macro is published monthly to quarterly, so a figure
            here is legitimately weeks old — saying so is the difference between "stale" and
            "that is simply when the statistics agency published". */}
        {macro.asOf ? <Text variant="muted">{ageLabel(macro.asOf)}</Text> : null}
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {rows.map((s) => (
          <View key={`${s.code}|${s.dimension}`} className="flex-row items-baseline justify-between">
            <Text variant="muted" className="flex-1 pr-3">
              {s.name}
              {s.dimension ? ` · ${s.dimension.replace(/_/g, ' ')}` : ''}
            </Text>
            <Text variant="body">{formatValue(s)}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

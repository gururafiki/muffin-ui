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
import { useCountryMacro } from './api/use-macro';
import { collapseRows, curvePoints, formatValue, maturityLabel } from './macro-format';

/**
 * Macro is published monthly to quarterly, so a figure here is legitimately weeks old. Saying so is
 * the difference between "stale" and "that is when the statistics agency published".
 */
function ageLabel(asOf: Date): string {
  const days = Math.floor((Date.now() - asOf.getTime()) / 86_400_000);
  if (days <= 1) return 'today';
  if (days < 45) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function MacroPanel({ iso2 }: { iso2: string | undefined }) {
  const macro = useCountryMacro(iso2);

  // No panel at all — neither while loading (it would flash) nor when the country has no series.
  if (macro.loading || macro.empty || macro.items.length === 0) return null;

  const rows = collapseRows(macro.items);

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
        {rows.map(({ head, group }) => {
          // A single-point series renders as itself; a term structure renders its benchmark points
          // on one line.
          if (group.length === 1 && !head.dimension) {
            return (
              <View key={head.code} className="flex-row items-baseline justify-between">
                <Text variant="muted" className="flex-1 pr-3">
                  {head.name}
                </Text>
                <Text variant="body">{formatValue(head)}</Text>
              </View>
            );
          }
          const shown = curvePoints(group);
          return (
            <View key={head.code} className="flex-row items-baseline justify-between">
              <Text variant="muted" className="flex-1 pr-3">
                {head.name}
              </Text>
              <Text variant="body">
                {shown.map((g) => `${maturityLabel(g.dimension)} ${formatValue(g)}`).join('  ·  ')}
              </Text>
            </View>
          );
        })}
      </Card>
    </>
  );
}

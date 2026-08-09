/**
 * Returns across every available period, side by side.
 *
 * The rest of the app shows ONE period at a time behind the timeframe picker; on a
 * single instrument the whole term structure fits and is more useful than making
 * the reader click through it (a name up 30% over 1Y but down 4% over 1M is one
 * glance here and five taps elsewhere).
 */
import { ScrollView, View } from 'react-native';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';

import { PERIOD_LABELS, type Period } from './api/periods';
import { changeTone } from './taxonomy';

const toneColor = { bullish: palette.bullish, bearish: palette.bearish, neutral: palette.neutral };

export function PerformanceStrip({
  returns,
}: {
  returns: { period: Period; changePct: number }[];
}) {
  if (returns.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row gap-2 pr-4">
        {returns.map(({ period, changePct }) => (
          <View
            key={period}
            className="min-w-[74px] items-center gap-0.5 rounded-crumb bg-frosting-100 px-3 py-2 dark:bg-night-surface-muted">
            <Text variant="label">{PERIOD_LABELS[period]}</Text>
            <Text
              variant="body"
              className="font-heading"
              style={{ color: toneColor[changeTone(changePct)] }}>
              {changePct >= 0 ? '+' : ''}
              {changePct.toFixed(1)}%
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

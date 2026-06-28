import { View } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from './text';

export type Signal = 'bullish' | 'bearish' | 'neutral' | 'info';

const tones: Record<Signal, string> = {
  bullish: 'bg-bullish/15 border-bullish/30',
  bearish: 'bg-bearish/15 border-bearish/30',
  neutral: 'bg-neutral/20 border-neutral/40',
  info: 'bg-frosting-100 dark:bg-night-surface-muted border-frosting-200 dark:border-night-border',
};

const textTones: Record<Signal, string> = {
  bullish: 'text-bullish',
  bearish: 'text-bearish',
  neutral: 'text-butter-600',
  info: 'text-frosting-600 dark:text-frosting-300',
};

export function Badge({ label, tone = 'info' }: { label: string; tone?: Signal }) {
  return (
    <View className={cn('self-start rounded-pill border px-2.5 py-1', tones[tone])}>
      <Text className={cn('font-heading text-xs uppercase tracking-wide', textTones[tone])}>
        {label}
      </Text>
    </View>
  );
}

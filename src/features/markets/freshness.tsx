/**
 * Says where a number came from.
 *
 * The app used to badge every market figure "SAMPLE" because every figure WAS
 * authored. Now that some are live, the badge has to distinguish them — a real
 * number still labelled "sample" is as misleading as a sample one that is not.
 */
import { View } from 'react-native';

import { Badge, Text } from '@/components/ui';

/** "just now" / "12m ago" / "3h ago" / "2d ago" — coarse on purpose. */
export function relativeAge(from: Date, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from.getTime()) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Freshness({
  sample,
  asOf,
  source,
  refreshing,
}: {
  sample: boolean;
  asOf?: Date | null;
  source?: string | null;
  refreshing?: boolean;
}) {
  if (sample) return <Badge label="sample" tone="info" />;

  return (
    <View className="flex-row items-center gap-2">
      {refreshing ? <Badge label="updating" tone="info" /> : null}
      <Text variant="muted" className="text-xs">
        {asOf ? relativeAge(asOf) : 'live'}
        {source ? ` · ${source}` : ''}
      </Text>
    </View>
  );
}

/**
 * The stock page's loading state.
 *
 * Co-located with the markets feature and shaped like what replaces it, per the skeleton doctrine:
 * a loading state should be the shape of what is coming, so filling it moves nothing. The stock
 * page rendered NOTHING while `useInstrument` was in flight — a symbol heading over blank space —
 * which reads as "this ticker has no data" rather than "still loading".
 *
 * Sized in LINE BOXES (`SkeletonText`), not bar thickness: a 14px bar where a 20px line will land
 * still shifts the page when it fills.
 */
import { View } from 'react-native';

import { Card, Skeleton, SkeletonText } from '@/components/ui';

export function StockSkeleton() {
  return (
    <View>
      {/* Heading + name, matching the display/muted pair above. */}
      <SkeletonText lines={1} kind="heading" className="mt-4 w-40" />
      <SkeletonText lines={1} kind="body" className="mt-1 w-56" />

      {/* The badge row: asset / sector / industry / country. Pills, because that is what lands. */}
      <View className="mt-2 flex-row flex-wrap gap-2">
        <Skeleton className="h-6 w-20 rounded-crumb" />
        <Skeleton className="h-6 w-24 rounded-crumb" />
        <Skeleton className="h-6 w-16 rounded-crumb" />
      </View>

      {/* The performance card: heading, the returns strip, then the chart. */}
      <Card className="mt-4 gap-3">
        <SkeletonText lines={1} kind="heading" className="w-32" />
        <View className="flex-row gap-3">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} className="flex-1 gap-1">
              <SkeletonText lines={1} kind="small" />
              <SkeletonText lines={1} kind="body" />
            </View>
          ))}
        </View>
        {/* The chart is the tall element; without it the card collapses and then jumps. */}
        <Skeleton className="h-40 w-full rounded-crumb" />
      </Card>
    </View>
  );
}

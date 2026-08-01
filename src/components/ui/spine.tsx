import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from '@/lib/cn';
import { StatusDot, type DotStatus } from './status-dot';

/**
 * The vertical connector that binds timeline rows into one run.
 *
 * Geometry follows the pattern already proven in `conversation.tsx`: a single absolute
 * 2px line running from just under the marker to below the row box, so it bridges the
 * inter-row gap and stops at the last row. Drawing it from the marker DOWN (rather than
 * as two halves around the marker) means it never needs an opaque background behind the
 * marker — which is what would otherwise break the moment a row sat on a `crust` card
 * instead of the app background.
 *
 * Three separate copies of this line existed before, each with its own offsets.
 */
const RAIL = { position: 'absolute' as const, top: 22, bottom: -12, width: 2 };

export function SpineRow({
  status,
  last,
  gutter = 26,
  marker,
  children,
  className,
}: {
  status?: DotStatus;
  /** Suppresses the downward rail — the last row of a spine. */
  last?: boolean;
  gutter?: number;
  /** Replaces the status marker (a sub-agent avatar, a tool glyph). */
  marker?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn('flex-row', className)}>
      <View style={{ width: gutter }} className="items-center">
        {!last ? <View style={RAIL} className="bg-frosting-200 dark:bg-night-border" /> : null}
        <View className="z-10 h-[22px] items-center justify-center">
          {marker ?? <StatusDot status={status} />}
        </View>
      </View>
      <View className="min-w-0 flex-1">{children}</View>
    </View>
  );
}

/**
 * The bracket around one superstep's parallel members.
 *
 * Parallelism is the thing the previous tree could not express at all — it flattened
 * every superstep into one list, so ten workers running at once and ten running in
 * sequence drew identically. A doubled left rail plus a header chip is deliberately a
 * *different shape* from the single-rail sequential spine, so the distinction survives
 * a glance. It stacks members vertically rather than side by side because a fan can be
 * 19 wide (council) and still has to read on a phone.
 */
export function ParallelFan({ header, last, children }: { header: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <View className="flex-row">
      <View style={{ width: 26 }} className="items-center">
        {!last ? <View style={{ ...RAIL, top: 26 }} className="bg-frosting-200 dark:bg-night-border" /> : null}
        <View className="z-10 h-[26px] w-full items-center justify-center">
          <View className="h-2.5 w-2.5 rotate-45 rounded-[3px] border-2 border-frosting-300 bg-dough dark:border-night-border dark:bg-night-bg" />
        </View>
      </View>
      <View className="min-w-0 flex-1 gap-1.5 pb-2">
        {header}
        <View className="gap-1.5 border-l-[3px] border-frosting-200 pl-2.5 dark:border-night-border">{children}</View>
      </View>
    </View>
  );
}

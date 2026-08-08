/**
 * The shared scaffolding every live run screen (generic runner, council, chat)
 * used to hand-roll: the stream context for detail components, the error card,
 * and the hydration-notice wrapper. Screens keep their own layout; this owns the
 * cross-cutting wiring.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Badge, Button, Card, ProgressBar, Text } from '@/components/ui';
import { RunStreamProvider } from '@/lib/agent/stream-context';
import type { RunStream } from '@/lib/agent/stream-types';
import { palette } from '@/theme/colors';
import { useEstimatedProgress } from './use-estimated-progress';

/**
 * Mount once per live run screen. Provides the stream handle (read by
 * `SubgraphDetail` / `MemberDetail` via `useRunStreamContext`).
 *
 * It also used to mount a `ToolCacheProvider`, which fetched the whole
 * `["cache", …]` store namespace (100 items, re-polled every 10s while busy) so
 * `ToolRunRow` could show a payload's size and age. M25 removed that join —
 * `output_preview` already carries the full result — but left the provider
 * mounted, so every run surface kept paying for a request nothing read. Deleted.
 */
export function RunSurface({
  stream,
  children,
}: {
  stream: RunStream;
  children: ReactNode;
}) {
  return <RunStreamProvider stream={stream}>{children}</RunStreamProvider>;
}

/**
 * The run's error, as a card — renders nothing while healthy.
 *
 * `onRetry` renders a Reconnect action. It is the escape hatch for the case the
 * SDK's own reconnect budget cannot cover: once `maxReconnectAttempts` is exhausted
 * the transport closes the event queue with the error and nothing will retry it on
 * its own. Reconnecting rebuilds the transport (re-hydrate + fresh event pump); it
 * never re-submits, so it is safe on a run that is still executing server-side.
 */
export function RunErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error == null) return null;
  return (
    <Card tone="outline" className="gap-2">
      <Badge label="error" tone="bearish" />
      <Text variant="muted">{error instanceof Error ? error.message : String(error)}</Text>
      {onRetry ? (
        <>
          <Text variant="muted" className="text-xs">
            The run may still be going on the server — reconnecting picks it back up.
          </Text>
          <View className="flex-row">
            <Button title="Reconnect" variant="secondary" size="sm" onPress={onRetry} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Hydration-notice wrapper for reopened threads (`stream.isThreadLoading` —
 * one `getState` that can take 28–70s on the deployed backend): a spinner +
 * label row and an eased progress bar with an estimated "time left", above
 * screen-specific skeleton content. The backend gives no real percent-complete
 * for the read, so the bar is a time heuristic (see `useEstimatedProgress`) —
 * it holds near the top until the state lands, then this card unmounts.
 */
export function HydrationCard({ label, children }: { label: string; children?: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const { value, remainingLabel } = useEstimatedProgress({ estimateMs: 45_000 });
  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-2.5">
        <ActivityIndicator size="small" color={palette.frosting[400]} />
        <Text variant="muted" className="flex-1 text-sm">{label}</Text>
        <Text variant="muted" className="text-xs">{remainingLabel}</Text>
      </View>
      <ProgressBar value={value} animate={!reduceMotion} accessibilityLabel={label} />
      {children}
    </Card>
  );
}

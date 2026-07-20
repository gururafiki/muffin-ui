/**
 * The shared scaffolding every live run screen (generic runner, council, chat)
 * used to hand-roll: the provider-call cache, the stream context for detail
 * components, the error card, and the hydration-notice wrapper. Screens keep
 * their own layout; this owns the cross-cutting wiring.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { RunStreamProvider } from '@/lib/agent/stream-context';
import type { RunStream } from '@/lib/agent/stream-types';
import { ToolCacheProvider } from '@/lib/agent/tool-cache';
import { palette } from '@/theme/colors';

/**
 * Mount once per live run screen. Provides the tool cache (joined by
 * `ToolRunsPanel` rows on expand) and the stream handle (read by
 * `SubgraphDetail` / `MemberDetail` via `useRunStreamContext`).
 */
export function RunSurface({
  stream,
  threadId,
  children,
}: {
  stream: RunStream;
  threadId?: string;
  children: ReactNode;
}) {
  return (
    <ToolCacheProvider thread={threadId} busy={stream.isLoading}>
      <RunStreamProvider stream={stream}>{children}</RunStreamProvider>
    </ToolCacheProvider>
  );
}

/** The run's error, as a card — renders nothing while healthy. */
export function RunErrorCard({ error }: { error: unknown }) {
  if (error == null) return null;
  return (
    <Card tone="outline" className="gap-1">
      <Badge label="error" tone="bearish" />
      <Text variant="muted">{error instanceof Error ? error.message : String(error)}</Text>
    </Card>
  );
}

/**
 * Hydration-notice wrapper for reopened threads (`stream.isThreadLoading` —
 * one `getState` that can take a while on the deployed backend): a spinner +
 * label row above screen-specific skeleton content.
 */
export function HydrationCard({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-2.5">
        <ActivityIndicator size="small" color={palette.frosting[400]} />
        <Text variant="muted" className="flex-1 text-sm">{label}</Text>
      </View>
      {children}
    </Card>
  );
}

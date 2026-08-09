/**
 * One past agent call, as a tappable card — and where tapping it goes.
 *
 * Extracted from the Calls tab so the stock page can list a ticker's runs without a
 * second copy. Copying it is how `smoke-market.mjs` inherited `skeleton-check.mjs`'s
 * path-traversal bug; one implementation is the fix.
 */
import type { Thread } from '@langchain/langgraph-sdk';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Badge, Card, Text } from '@/components/ui';
import { getAgent } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

import {
  agentTitleForThread,
  relativeTime,
  threadAgentIcon,
  threadDescriptor,
  threadGraphId,
  threadStatusTone,
} from './threads';

/** Status badge that gently pulses while the run is live. */
export function StatusBadge({ status }: { status: Thread['status'] }) {
  const pulse = useSharedValue(1);
  const busy = status === 'busy';
  useEffect(() => {
    pulse.value = busy ? withRepeat(withTiming(0.4, { duration: 750 }), -1, true) : withTiming(1);
  }, [busy, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (!busy) return <Badge label={status} tone={threadStatusTone(status)} />;
  return (
    <Animated.View style={style}>
      <Badge label="running" tone="info" />
    </Animated.View>
  );
}

/**
 * Reopen a thread on its agent's own screen when the graph is one we render, and
 * fall back to the generic read-only detail page when it is not (an older or
 * unregistered graph still has history worth showing).
 */
export function openThreadRoute(router: ReturnType<typeof useRouter>, thread: Thread) {
  const id = threadGraphId(thread);
  if (id && getAgent(id)) {
    router.push({
      pathname: '/agents/[assistantId]',
      params: { assistantId: id, threadId: thread.thread_id },
    });
  } else {
    router.push(`/calls/${thread.thread_id}`);
  }
}

export function CallCard({
  thread,
  onOpen,
}: {
  thread: Thread;
  onOpen: (thread: Thread) => void;
}) {
  const descriptor = threadDescriptor(thread);
  return (
    <Pressable onPress={() => onOpen(thread)} className="active:opacity-80">
      <Card tone="sticker" className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
          <Icon name={threadAgentIcon(thread)} size={26} color={palette.frosting[600]} />
        </View>
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text variant="heading" className="flex-shrink">
              {agentTitleForThread(thread)}
            </Text>
            <StatusBadge status={thread.status} />
          </View>
          {descriptor ? (
            <Text variant="body" className="text-sm" numberOfLines={1}>
              {descriptor}
            </Text>
          ) : null}
          <Text variant="muted" className="text-xs">
            {relativeTime(thread.created_at)}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color={palette.frosting[300]} weight="bold" />
      </Card>
    </Pressable>
  );
}

/**
 * Refresh ONE security, from its stock page, by queueing the Dagster company lane for it.
 *
 * Since Phase 4 (2026-10-18) `security-refresh` fetches nothing itself. It launches this security's
 * partition of the `yahoo_companies` job with `force: true`, which asks Yahoo for the summary and
 * the annual and quarterly statements whatever is already held. The run queues behind the provider
 * pool like any other, so the figures arrive minutes later. That is why the button says "queued"
 * and never "refreshed": a reload straight after would show nothing new.
 *
 * Returns are not part of it: they come from the price lane's nightly run.
 *
 * Admin-only and hidden otherwise, like every other refresh control: the server rejects a non-admin
 * token, so a button everyone can see is a button that fails for almost everyone.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { triggerRefresh } from './api/market-client';

/** What the button does and where from: a reader cannot infer either from the word "refresh". */
const WHAT_IT_DOES =
  'Queues this stock’s company data: Yahoo’s summary and statements, through the Dagster company lane';

/**
 * Why a press was not queued, from the function's answer. A 200 is not proof the work happened:
 * `skipped` means another press claimed the resource within the last minute, and `queued: false`
 * carries Dagster's own reason (an unknown symbol, or a security with no partition yet).
 */
function notQueuedReason(body: Record<string, unknown> | null): string | null {
  if (!body || body.queued === true) return null;
  if (body.skipped === true) return 'a refresh was requested a moment ago; try again in a minute';
  return typeof body.reason === 'string' ? body.reason : 'the server did not queue it';
}

export function SecurityRefreshButton({ symbol }: { symbol: string }) {
  const isAdmin = useAuth((s) => s.session?.isAdmin ?? false);
  const [showInfo, setShowInfo] = useState(false);

  const refresh = useMutation({
    mutationFn: () => triggerRefresh('security-refresh', { symbol }),
    onError: (e) => console.warn(`[market] ${symbol} refresh failed, keeping existing: ${String(e)}`),
  });

  if (!isAdmin) return null;

  const queued = refresh.isSuccess && refresh.data?.queued === true;
  const refusal = refresh.isSuccess ? notQueuedReason(refresh.data ?? null) : null;
  const label = refresh.isPending ? 'queueing…' : queued ? 'queued' : 'Refresh';

  return (
    <View className="items-end">
      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What does refresh do?"
          onPress={() => setShowInfo((v) => !v)}
          className="h-5 w-5 items-center justify-center rounded-full border border-frosting-300 active:opacity-70">
          <Text variant="muted" className="text-[10px]">i</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Refresh ${symbol}`}
          disabled={refresh.isPending || queued}
          onPress={() => refresh.mutate()}
          className="flex-row items-center gap-1.5 rounded-crumb px-2 py-1 active:opacity-70">
          <Icon
            name="refresh"
            size={16}
            color={refresh.isPending || queued ? palette.frosting[300] : palette.frosting[600]}
          />
          <Text variant="muted" className="text-xs">{label}</Text>
        </Pressable>
      </View>
      {queued ? (
        <Text variant="muted" className="text-[11px]">
          Updates in a few minutes; reload the page then.
        </Text>
      ) : null}
      {refusal ? (
        <Text variant="muted" className="text-[11px]">Not queued: {refusal}</Text>
      ) : null}
      {showInfo ? (
        <View className="mt-1 max-w-xs rounded-crumb bg-frosting-50 p-2 dark:bg-night-surface-muted">
          <Text variant="muted" className="text-[11px]">• {WHAT_IT_DOES}</Text>
          <Text variant="muted" className="text-[10px] opacity-70">
            This security only — not the whole universe.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

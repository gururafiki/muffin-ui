/**
 * Refresh ONE security, from its stock page.
 *
 * The page-level `RefreshButton` triggers whole-resource refreshes, which are budgeted as backlogs
 * and would refuse on their TTL — and refreshing 10,060 securities to see one is the wrong trade.
 * `security-refresh` does returns, market cap, fundamentals AND statements for a single symbol.
 *
 * Statements are here for a reason worth knowing: the backlog that fills them fetches one security
 * at a time (the provider does not accept several symbols on those endpoints — measured), so at 60
 * a run it is about five weeks deep. Without this, the securities someone actually opens would be
 * among the LAST to get statements. Three requests on a button a person pressed fixes that for the
 * one security they are looking at.
 *
 * Admin-only and hidden otherwise, like every other refresh control: the server rejects a non-admin
 * token, so a button everyone can see is a button that fails for almost everyone.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { triggerRefresh } from './api/market-client';
import { RESOURCE_INFO } from './refresh-button';

export function SecurityRefreshButton({ symbol }: { symbol: string }) {
  const isAdmin = useAuth((s) => s.session?.isAdmin ?? false);
  const queryClient = useQueryClient();
  const [showInfo, setShowInfo] = useState(false);

  const refresh = useMutation({
    mutationFn: () => triggerRefresh('security-refresh', { symbol }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['market', 'fundamentals', symbol] });
      queryClient.invalidateQueries({ queryKey: ['market', 'performance', 'instrument'] });
      queryClient.invalidateQueries({ queryKey: ['market', 'instrument', symbol] });
    },
    onError: (e) => console.warn(`[market] ${symbol} refresh failed, keeping existing: ${String(e)}`),
  });

  if (!isAdmin) return null;

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
          disabled={refresh.isPending}
          onPress={() => refresh.mutate()}
          className="flex-row items-center gap-1.5 rounded-crumb px-2 py-1 active:opacity-70">
          <Icon name="refresh" size={16} color={refresh.isPending ? palette.frosting[300] : palette.frosting[600]} />
          <Text variant="muted" className="text-xs">{refresh.isPending ? 'refreshing…' : 'Refresh'}</Text>
        </Pressable>
      </View>
      {showInfo ? (
        <View className="mt-1 max-w-xs rounded-crumb bg-frosting-50 p-2 dark:bg-night-surface-muted">
          <Text variant="muted" className="text-[11px]">• {RESOURCE_INFO['security-refresh']}</Text>
          <Text variant="muted" className="text-[10px] opacity-70">
            This security only — not the whole universe.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Refresh ONE security, from its stock page.
 *
 * The page-level `RefreshButton` triggers whole-resource refreshes, which are budgeted as backlogs
 * and would refuse on their TTL — and refreshing 10,060 securities to see one is the wrong trade.
 * `security-refresh` does returns, market cap and fundamentals for a single symbol.
 *
 * Admin-only and hidden otherwise, like every other refresh control: the server rejects a non-admin
 * token, so a button everyone can see is a button that fails for almost everyone.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable } from 'react-native';

import { Icon } from '@/components/icons';
import { Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { triggerRefresh } from './api/market-client';

export function SecurityRefreshButton({ symbol }: { symbol: string }) {
  const isAdmin = useAuth((s) => s.session?.isAdmin ?? false);
  const queryClient = useQueryClient();

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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Refresh ${symbol}`}
      disabled={refresh.isPending}
      onPress={() => refresh.mutate()}
      className="flex-row items-center gap-1.5 rounded-crumb px-2 py-1 active:opacity-70">
      <Icon name="refresh" size={16} color={refresh.isPending ? palette.frosting[300] : palette.frosting[600]} />
      <Text variant="muted" className="text-xs">{refresh.isPending ? 'refreshing…' : 'Refresh'}</Text>
    </Pressable>
  );
}

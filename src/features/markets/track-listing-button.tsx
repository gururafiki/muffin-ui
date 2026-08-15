/**
 * Pull an untracked exchange listing into the universe.
 *
 * WHY THIS EXISTS. The OpenFIGI sweep has catalogued 99,811 listings across 59 venues, and search
 * reaches all of them — but a reader who finds one could do nothing with it. `promote-listing` has
 * existed and worked since the directory was built (verified end to end: BABA returns
 * `promoted: true`, and `security-refresh` then gives it a market cap, seven return periods,
 * fundamentals and twelve statement rows). Nothing called it. This is the button.
 *
 * ADMIN ONLY, and shown only to admins — the same rule and the same reason as `RefreshButton`:
 * `market-refresh` rejects a non-admin token, so a button everyone can see is a button that fails
 * for almost everyone. The client boolean decides what the UI OFFERS; the server checks the claim
 * on the verified token and is the actual permission.
 *
 * PROMOTED BY FIGI, not by ticker. The directory row carries the exact FIGI the sweep enumerated,
 * and `promote-listing` resolves a bare ticker through `/v3/mapping` only because it has to when a
 * caller has nothing better. We have something better, and a ticker is ambiguous across venues —
 * `005930` is Samsung in Seoul and an unrelated line elsewhere.
 *
 * IT DOES NOT PRICE THE SECURITY. Promotion creates the security and its identifiers; the sector,
 * returns, fundamentals and statements arrive from the ordinary backlogs on their next run. Saying
 * so is the point — a button that implied instant data would be a promise the pipeline does not
 * make, and the row would sit there looking broken for an hour.
 */
import { useMutation } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { triggerRefresh } from './api/market-client';

export function TrackListingButton({
  figi,
  label,
  onTracked,
}: {
  figi: string;
  /** The security's name, for the accessibility label — "Track" alone says nothing about what. */
  label: string;
  onTracked?: () => void;
}) {
  const isAdmin = useAuth((s) => s.session?.isAdmin ?? false);

  const track = useMutation({
    // A 200 FROM THIS FUNCTION IS NOT PROOF THE WORK HAPPENED, and this is the one caller that
    // cannot treat it as such. `promote-listing` answers `{ skipped: true, reason: 'fresh or in
    // flight' }` when the TTL has not elapsed or another invocation holds the lock — measured
    // directly against production — and it answers `{ promoted: false }` when it resolved a FIGI it
    // could not build a security from. Both are 200s. A button that says "added" for either is the
    // same silent no-op this pipeline keeps producing, except now a person is watching it.
    mutationFn: async () => {
      const body = await triggerRefresh('promote-listing', { figi });
      if (!body || body.promoted !== true) {
        const why = String(body?.reason ?? body?.error ?? 'the server did not promote it');
        throw new Error(why);
      }
      return body;
    },
    onSuccess: () => onTracked?.(),
    // A failure must not blank the row: the listing is still findable, it just is not tracked.
    onError: (e) => console.warn(`[market] promote-listing did not promote: ${String(e)}`),
  });

  if (!isAdmin) return null;

  if (track.isSuccess) {
    return (
      <View className="flex-row items-center gap-1">
        <Icon name="check" size={14} color={palette.leaf[600]} />
        {/* Deliberately not "Tracked" alone: the security exists now and has no prices yet, and a
            reader who taps through to an empty page would reasonably think it had failed. */}
        <Text variant="muted" className="text-[11px]">added · data arrives on the next refresh</Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Track ${label}`}
      disabled={track.isPending}
      onPress={() => track.mutate()}
      className="flex-row items-center gap-1 rounded-crumb border border-frosting-300 px-2 py-1 active:opacity-70">
      <Icon name="plus" size={13} color={track.isPending ? palette.frosting[300] : palette.frosting[600]} />
      <Text variant="muted" className="text-[11px]">
        {track.isPending ? 'adding…' : track.isError ? 'retry' : 'Track'}
      </Text>
    </Pressable>
  );
}

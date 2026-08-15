/**
 * Find a company by name or ticker, across BOTH the tracked universe and the exchange directory.
 *
 * The only way to reach a security was Globe → country → sector, so anything the tracked funds
 * hold that no page happens to list was unreachable. That was fixed; this fixes the larger half.
 *
 * The OpenFIGI sweep has catalogued **63,411 listings across 54 venues, 62,880 of them untracked**
 * (2026-08-14) — and search read `security_current` alone, so the entire catalogue was invisible to
 * the one feature whose job is finding a company. "Samsung" returned nothing for Samsung Biologics
 * or Samsung C&T, both of which the app had enumerated and could name.
 *
 * Directory hits are shown SEPARATELY and are not openable. There is no stock page for a security
 * with no price series, and a chevron promising one is the fake affordance a screenshot caught on
 * the sector list. Saying "we know this exists and do not track it yet" is the honest answer, and a
 * better one than an empty result.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Card, Field, Text } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';

import { useSecuritySearch } from './api/use-security-search';
import { DrillList } from './drill-list';
import { getCountryByIso, getSector } from './taxonomy';
import { TrackListingButton } from './track-listing-button';

export function SecuritySearch({ onSelect }: { onSelect: (ticker: string) => void }) {
  const [query, setQuery] = useState('');
  const { items, trackedCount, untrackedCount, searching, ready } = useSecuritySearch(query);
  const queryClient = useQueryClient();
  const tracked = items.filter((s) => !s.untracked);
  const untracked = items.filter((s) => s.untracked);

  return (
    <Card className="mt-4 gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">Find a company</Text>
        {searching ? <Text variant="muted" className="text-xs">searching…</Text> : null}
      </View>
      <Field
        placeholder="Name or ticker — e.g. Samsung, NVDA"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search securities"
      />

      {ready && tracked.length > 0 ? (
        <DrillList
          items={tracked.map((s) => ({
            key: s.id,
            title: s.symbol ? `${s.symbol} · ${s.name}` : s.name,
            subtitle: [getSector(s.sectorId ?? '')?.name, getCountryByIso(s.country ?? '')?.name ?? s.country]
              .filter(Boolean)
              .join(' · '),
            // A security whose ticker is unresolved has no stock page — same rule as the sector
            // list, where a chevron promising one was the first thing a screenshot caught.
            disabled: !s.symbol,
          }))}
          onSelect={(key) => {
            const hit = items.find((s) => s.id === key);
            if (hit?.symbol) onSelect(hit.symbol);
          }}
        />
      ) : null}

      {/* The directory. Labelled, below the tracked results, and inert — these are listings the app
          has enumerated but holds no data for, so every row is `disabled`. */}
      {ready && untracked.length > 0 ? (
        <View className="mt-1 gap-2">
          <Text variant="label">Listed, not tracked yet</Text>
          <Text variant="muted" className="text-xs">
            {untrackedCount === 1 ? 'One listing is' : `${untrackedCount} listings are`} in the
            exchange directory with no prices or fundamentals yet
            {trackedCount > 0 ? ', below the results above' : ''}. Tracking one creates the security;
            its sector, prices and fundamentals arrive on the next refresh.
          </Text>
          {/* Rendered as rows rather than a DrillList: each carries its own action, and a list
              whose items are inert except for a button inside them is not a drill list. */}
          <View className="gap-1">
            {untracked.map((s) => (
              <View
                key={s.id}
                className="flex-row items-center justify-between gap-3 rounded-crumb bg-frosting-50 px-3 py-2 dark:bg-night-surface-muted">
                <View className="flex-1">
                  <Text className="text-sm" numberOfLines={1}>
                    {s.symbol ? `${s.symbol} · ${s.name}` : s.name}
                  </Text>
                  <Text variant="muted" className="text-xs">
                    {[getCountryByIso(s.country ?? '')?.name ?? s.country, s.exchange]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {/* `s.id` is `listing:<figi>` — see `searchDirectory`. The FIGI is the exact one the
                    sweep enumerated, which is a better key than the ticker `promote-listing` would
                    otherwise have to resolve. */}
                <TrackListingButton
                  figi={s.id.replace(/^listing:/, '')}
                  label={s.name}
                  onTracked={() => {
                    // The security exists now, so the tracked half of the next search should find
                    // it and the directory half should stop offering it.
                    queryClient.invalidateQueries({ queryKey: ['market', 'security-search'] });
                    queryClient.invalidateQueries({ queryKey: ['market', 'directory-search'] });
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Distinguishes "searched and found nothing" from "keep typing" — they look identical
          otherwise, and only one of them is worth saying. */}
      {ready && !searching && items.length === 0 ? (
        <Text variant="muted">No company matches “{query.trim()}”.</Text>
      ) : null}
    </Card>
  );
}

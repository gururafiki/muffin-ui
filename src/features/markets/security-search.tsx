/**
 * Find a company by name or ticker.
 *
 * The only way to reach a security was Globe → country → sector, so anything the tracked funds
 * hold that no page happens to list — most of 10,060 — was unreachable.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Card, Field, Text } from '@/components/ui';

import { useSecuritySearch } from './api/use-security-search';
import { DrillList } from './drill-list';
import { getCountryByIso, getSector } from './taxonomy';

export function SecuritySearch({ onSelect }: { onSelect: (ticker: string) => void }) {
  const [query, setQuery] = useState('');
  const { items, searching, ready } = useSecuritySearch(query);

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

      {ready && items.length > 0 ? (
        <DrillList
          items={items.map((s) => ({
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

      {/* Distinguishes "searched and found nothing" from "keep typing" — they look identical
          otherwise, and only one of them is worth saying. */}
      {ready && !searching && items.length === 0 ? (
        <Text variant="muted">No company matches “{query.trim()}”.</Text>
      ) : null}
    </Card>
  );
}

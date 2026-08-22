/**
 * Who runs the company.
 *
 * PAY IS RENDERED THROUGH `formatMoney` WITH THE VIEW'S OWN CURRENCY, and where the view has none
 * the figure appears unlabelled. That is not a gap to be filled in later with a `$`: SK hynix's
 * chief executive is stored as 4,239,000,000 — won, about $3m — and this app has already shipped
 * the version of this bug where Alibaba's CNY revenue rendered as "$1.02T". An unlabelled magnitude
 * is the honest thing to show when nothing in the data says what the number is denominated in.
 *
 * The CEO is flagged server-side rather than inferred from the sort, because a list ordered by pay
 * alone puts whoever was granted the most equity that year at the top.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useLeadership } from './api/use-leadership';
import { formatMoney } from './money';

export function Leadership({ securityId }: { securityId: string | null | undefined }) {
  const { officers, loading, empty } = useLeadership(securityId);

  // NOTHING AT ALL RENDERS NOTHING — 94 securities have officers against ~12,000 in the universe,
  // so an empty card headed "Leadership" would read as a broken section rather than as a queue.
  if (loading || empty) return null;

  // Every officer in one response shares a fiscal year in practice; showing it once above the list
  // is the difference between "this is their pay" and "this is what they were paid in 2025".
  const year = officers.find((o) => o.fiscalYear !== null)?.fiscalYear ?? null;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Leadership</Text>
        {year !== null ? <Text variant="muted">{`Pay, FY${year}`}</Text> : null}
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {officers.map((o) => (
          <View key={o.name} className="flex-row items-baseline justify-between gap-3">
            <View className="flex-1">
              <Text variant="body">{o.name}</Text>
              {o.title ? <Text variant="muted">{o.title}</Text> : null}
            </View>
            {/* A MISSING PAY IS BLANK, NOT ZERO. Most non-US filers disclose no individual pay at
                all, and "0" would read as an unpaid executive. */}
            {o.pay !== null ? (
              <Text variant="body">{formatMoney(o.pay, o.payCurrency)}</Text>
            ) : null}
          </View>
        ))}
      </Card>
    </>
  );
}

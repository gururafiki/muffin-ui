/**
 * The three financial statements, as tables.
 *
 * The stock page showed the income statement only — four periods, four hand-picked line items,
 * pulled out of jsonb by name. Balance sheet and cash flow were in the database and unreachable.
 *
 * WHY THIS READS THE METRIC LAYER. The two statement providers share almost no field names — SEC
 * and yfinance agree on 4 of 40 income lines, and pre-tax income is `total_pretax_income` on one
 * and `total_pre_tax_income` on the other, one character apart. Picking keys here would mean a
 * second copy of the `metric_source_field` catalogue living in the client, free to drift. The
 * server has resolved that once; this renders the result.
 *
 * MONEY CARRIES ITS CURRENCY. `formatMoney` asks CLDR rather than assuming dollars — Alibaba's CNY
 * 1,023,670,000,000 once rendered as "$1.02T" against a true ~$141bn, and `$` is ambiguous even
 * when it is right (USD/CAD/AUD/HKD/SGD all print as `$`). With no currency the figure goes out
 * unlabelled, which is the honest answer.
 */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Badge, Card, Segmented, Text } from '@/components/ui';

import { useStatementTable, type StatementCategory } from './api/use-statement-table';
import type { PeriodType } from './api/use-security-metrics';
import { formatMoney } from './money';

const TABS: { id: StatementCategory; label: string }[] = [
  { id: 'income_statement', label: 'Income' },
  { id: 'balance_sheet', label: 'Balance' },
  { id: 'cash_flow', label: 'Cash flow' },
];

/** `2025-09-30` -> `2025`; the column header only needs the year to be legible on a phone. */
function periodLabel(iso: string): string {
  return iso.slice(0, 4);
}

export function StatementTables({ symbol }: { symbol: string | undefined }) {
  const [category, setCategory] = useState<StatementCategory>('income_statement');
  const [period, setPeriod] = useState<PeriodType>('annual');
  const { periods, lines, currency, loading, empty } = useStatementTable(symbol, category, period);

  // NOTHING AT ALL RENDERS NOTHING — but only while this is the FIRST view. Once a reader has
  // switched tabs, hiding the section because that particular statement is missing would make the
  // tabs they were just using disappear under them.
  const [touched, setTouched] = useState(false);
  if (loading && !touched) return null;
  if (empty && !touched) return null;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Financial statements</Text>
        <Segmented
          options={[
            { id: 'annual', label: 'Annual' },
            { id: 'quarter', label: 'Quarterly' },
          ]}
          value={period}
          onChange={(v) => {
            setTouched(true);
            setPeriod(v as PeriodType);
          }}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
        <View className="flex-row gap-1.5">
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => {
                setTouched(true);
                setCategory(t.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={t.label}
            >
              <Badge label={t.label} tone={t.id === category ? 'info' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Card tone="muted" className="mt-2 gap-2">
        {lines.length === 0 ? (
          <Text variant="muted">
            {loading ? 'Loading…' : 'This company reports no lines for that statement.'}
          </Text>
        ) : (
          <>
            <View className="flex-row items-baseline">
              <Text variant="muted" className="flex-1 pr-2">
                {currency ? `Figures in ${currency}` : 'Figures unlabelled — currency unknown'}
              </Text>
              {periods.map((p) => (
                <Text key={p} variant="muted" className="w-16 text-right">
                  {periodLabel(p)}
                </Text>
              ))}
            </View>
            {lines.map((line) => (
              <View key={line.code} className="flex-row items-baseline">
                <Text variant="muted" className="flex-1 pr-2">
                  {line.name}
                </Text>
                {line.values.map((v, i) => (
                  <Text key={periods[i] ?? i} variant="body" className="w-16 text-right">
                    {/* An absent figure is a DASH, never a zero: "0" is a number this company
                        reported and this is the absence of one. */}
                    {v === null
                      ? '—'
                      : line.unit === 'currency'
                        ? formatMoney(v, currency)
                        : v.toLocaleString('en-US')}
                  </Text>
                ))}
              </View>
            ))}
          </>
        )}
      </Card>
    </>
  );
}

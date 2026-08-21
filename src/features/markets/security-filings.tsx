/**
 * The company's own filings, with the periodic reports separated from the events.
 *
 * WHY THE SPLIT IS THE FEATURE. A company files dozens of 8-Ks a year and one annual report. Sorted
 * by date alone, the 10-K a reader actually wants is somewhere below a month of press releases —
 * so the annual and interim reports get their own group at the top, and the events follow.
 *
 * The classification comes from the SERVER (`kind`), not from reading `report_type` here. Two
 * vocabularies exist — a domestic registrant files 10-K/10-Q, a foreign private issuer files
 * 20-F/6-K instead — and reimplementing that rule in the client would let this screen disagree with
 * the database about what an annual report is.
 */
import { Linking, Pressable, View } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useSecurityFilings, type Filing } from './api/use-security-filings';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2025-10-31` -> `31 Oct 2025`, from the string's parts.
 *
 * Never `new Date(iso)`: a bare date parses as UTC midnight, so a reader west of Greenwich sees the
 * previous day. Wrong by one on a filing date is a wrong quarter at a year boundary.
 */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

function FilingRow({ filing }: { filing: Filing }) {
  const body = (
    <View className="flex-row items-baseline justify-between">
      <Text variant="body" className="flex-1 pr-3">
        {filing.reportType ?? 'Filing'}
      </Text>
      <Text variant="muted">{formatDate(filing.filingDate)}</Text>
    </View>
  );
  // NOT TAPPABLE WITHOUT A URL. A row that looks like a link and does nothing is worse than a row
  // that plainly is not one.
  if (!filing.url) return body;
  return (
    <Pressable
      onPress={() => Linking.openURL(filing.url as string)}
      accessibilityRole="link"
      accessibilityLabel={`${filing.reportType ?? 'Filing'} ${formatDate(filing.filingDate)}`}
    >
      {body}
    </Pressable>
  );
}

export function SecurityFilings({ securityId }: { securityId: string | null | undefined }) {
  const { periodic, events, loading, empty } = useSecurityFilings(securityId);

  // SEC-only: most of the universe has no CIK and therefore no filings. No section rather than an
  // empty one, the rule every panel here follows.
  if (loading || empty) return null;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Filings</Text>
        <Text variant="muted">SEC</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {periodic.map((f) => (
          <FilingRow key={f.accession} filing={f} />
        ))}
        {periodic.length > 0 && events.length > 0 ? (
          <Text variant="muted" className="mt-1">
            Other filings
          </Text>
        ) : null}
        {events.slice(0, 6).map((f) => (
          <FilingRow key={f.accession} filing={f} />
        ))}
      </Card>
    </>
  );
}

/**
 * What this security is missing — admin only.
 *
 * Gated exactly as `security-refresh-button.tsx` gates: `useAuth((s) => s.session?.isAdmin ?? false)`
 * then an early return. The query is `enabled` on the same flag, so a reader who will never see
 * this never fetches it either.
 *
 * THREE STATES, AND THE THIRD IS THE POINT. A facet can be present, missing, or NOT APPLICABLE —
 * no regulator can serve a Cayman shell a segment disclosure, and counting that as missing is what
 * made 74 ETFs read 0% complete. `required` is typed per security type by the `required_facet`
 * control table, so a bond is not charged for the sector and industry it will never have.
 *
 * TWO NUMBERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. "Core" is the gate — does this hold
 * everything its type owes. "Breadth" is how much of what it COULD have, it has. A security can be
 * core-complete and thin, which is exactly the state worth seeing on an admin panel.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { palette } from '@/theme/colors';

import { useCompleteness } from './api/use-completeness';

/** `sic` -> `SIC`, `segment_geography` -> `Segment geography`. */
function label(facet: string): string {
  if (facet === 'sic') return 'SIC';
  const s = facet.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function SecurityCompleteness({ securityId }: { securityId: string | null | undefined }) {
  const isAdmin = useAuth((s) => s.session?.isAdmin ?? false);
  const { rows, presentCount, applicableCount, requiredMissing, loading, empty } = useCompleteness(
    securityId,
    isAdmin,
  );

  if (!isAdmin) return null;
  if (loading || empty) return null;

  const pct = applicableCount > 0 ? Math.round((100 * presentCount) / applicableCount) : 0;

  return (
    <>
      <View className="mt-5 flex-row items-baseline justify-between">
        <Text variant="label">Coverage (admin)</Text>
        <Text variant="muted">
          {requiredMissing.length === 0 ? 'core complete' : `${requiredMissing.length} required missing`}
          {' · '}
          {presentCount}/{applicableCount} facets ({pct}%)
        </Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {requiredMissing.length > 0 ? (
          <Text variant="body">
            Missing and required: {requiredMissing.map((r) => label(r.facet)).join(', ')}
          </Text>
        ) : null}

        <View className="flex-row flex-wrap gap-1.5">
          {rows.map((r) => {
            // Not applicable reads as neither good nor bad — it is not a gap, and colouring it as
            // one is the miscalibration this panel exists to avoid.
            const bg = !r.applicable
              ? palette.frosting[100]
              : r.present
                ? palette.bullish
                : r.required
                  ? palette.bearish
                  : palette.butter[400];
            const fg = !r.applicable ? palette.inkMuted : palette.white;
            return (
              <View key={r.facet} style={{ backgroundColor: bg }} className="rounded-pill px-2 py-0.5">
                <Text variant="muted" style={{ color: fg }} className="text-[11px]">
                  {label(r.facet)}
                  {!r.applicable ? ' —' : r.present ? '' : r.required ? ' !' : ' ·'}
                </Text>
              </View>
            );
          })}
        </View>

        <Text variant="muted" className="text-[11px]">
          Green present · red missing and required · amber missing but optional · grey not applicable
          (no source can serve it). Requirements are typed per security type.
        </Text>
      </Card>
    </>
  );
}

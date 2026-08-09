/**
 * Timeframe control for performance figures.
 *
 * The choice lives in the persisted map-view store rather than component state, so
 * it survives navigation between the globe, a country and a sector — switching to
 * 3M and drilling in should not silently snap back to 1Y.
 *
 * `periods` is passed by the caller because coverage is per scope: finviz's grouped
 * sector performance has no multi-year windows, while country ETFs do. Offering a
 * period the data cannot serve renders an empty panel that reads as a bug.
 */
import { Segmented } from '@/components/ui';

import { PERIOD_LABELS, SECTOR_PERIODS, type Period } from './api/periods';
import { useMapView } from './map-view-store';

export function PeriodPicker({ periods = SECTOR_PERIODS }: { periods?: Period[] }) {
  const period = useMapView((s) => s.period);
  const setPeriod = useMapView((s) => s.setPeriod);

  return (
    <Segmented
      options={periods.map((p) => ({ id: p, label: PERIOD_LABELS[p] }))}
      value={periods.includes(period) ? period : periods[0]}
      onChange={setPeriod}
    />
  );
}

/**
 * The active period, clamped to what the caller's scope can serve.
 *
 * Without the clamp, picking 1Y on a country page (which supports it) and then
 * opening a sector panel (which may not) would query a period with no rows and fall
 * back to sample data for no visible reason.
 */
export function useActivePeriod(periods: Period[] = SECTOR_PERIODS): Period {
  const period = useMapView((s) => s.period);
  return periods.includes(period) ? period : periods[0];
}

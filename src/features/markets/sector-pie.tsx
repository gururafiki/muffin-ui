/**
 * The markets sector donut. The geometry now comes from `charts/donut.tsx`.
 *
 * This file used to carry its own polar and arc maths — the fourth-ish hand-rolled arc in the wild,
 * and the one that had to get the large-arc flag right. That is d3-shape's job, and sharing the
 * component means the sector donut and the business-line donuts spin in the same way rather than
 * being two chart styles in one app. What stays here is what is actually about SECTORS: which
 * slices exist, and the fallback to the authored weights the caller badges SAMPLE.
 */
import { View } from 'react-native';

import { chartColors, palette } from '@/theme/colors';

import { Donut, type DonutSlice } from './charts/donut';
import { SECTORS, SECTOR_WEIGHTS, type Sector } from './taxonomy';

/**
 * Build the slices from real weights when they are available, and from the authored map otherwise.
 *
 * Real weights are ordered by size and only include sectors the fund actually holds, so the slice
 * list is NOT `SECTORS` — a sector a fund holds none of must not appear as a zero-width wedge that
 * still takes a colour and a legend entry.
 */
function buildSlices(weights?: { sectorId: string; weightPct: number }[]): (DonutSlice & { sector: Sector })[] {
  const source =
    weights && weights.length > 0
      ? weights
          .map((w) => ({ sector: SECTORS.find((s) => s.id === w.sectorId), weight: w.weightPct }))
          .filter((x): x is { sector: Sector; weight: number } => !!x.sector)
      : SECTORS.map((sector) => ({ sector, weight: SECTOR_WEIGHTS[sector.id] ?? 1 }));

  return source.map(({ sector, weight }, i) => ({
    key: sector.id,
    label: sector.name,
    value: weight,
    color: chartColors.sector[i % chartColors.sector.length],
    sector,
  }));
}

/** Interactive donut of sector weights. Tap a slice to select it. */
export function SectorPie({
  selectedId,
  onSelect,
  weights,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Real, renormalised weights. Omitted -> the authored map, which the caller badges SAMPLE. */
  weights?: { sectorId: string; weightPct: number }[];
}) {
  // NOT `useState(buildSlices)`: that captures the first render's value forever, so the donut would
  // keep drawing the authored weights after the real ones arrive.
  const slices = buildSlices(weights);
  const selected = slices.find((s) => s.key === selectedId);
  const total = slices.reduce((a, s) => a + s.value, 0);

  return (
    <View className="items-center">
      <Donut
        slices={slices}
        size={240}
        thickness={0.53}
        selectedKey={selectedId}
        // The sector page treats selection as navigation, so a second tap re-selects rather than
        // clearing — `Donut` offers null on deselect and this caller declines it.
        onSelect={(key) => onSelect(key ?? selectedId ?? slices[0]?.key)}
        gap={palette.dough}
        animationKey={weights ? 'live' : 'sample'}
        sliceLabel={(_s, sharePct) => (sharePct >= 6 ? `${sharePct.toFixed(0)}%` : null)}
        centerPrimary={selected ? selected.sector.name.split(' ')[0] : 'Sectors'}
        centerSecondary={
          selected && total > 0 ? `${((selected.value / total) * 100).toFixed(1)}% wt` : 'tap a slice'
        }
      />
    </View>
  );
}

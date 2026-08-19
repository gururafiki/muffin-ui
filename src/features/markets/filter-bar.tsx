/**
 * The Markets filter surface — one collapsible panel of chip groups over `MarketFilter`.
 *
 * Built from the existing `Chip` + `Collapsible` primitives rather than a new control set;
 * `advanced-options.tsx` is the precedent for a collapsible panel of chip selects.
 *
 * TWO THINGS THIS COMPONENT IS DELIBERATELY NOT.
 *
 * It does not fetch. The vocabularies (which sectors exist, which tiers) are passed in, because the
 * caller already holds them and a filter bar that issued its own queries would refetch them on every
 * screen that mounts it.
 *
 * It does not filter. It edits a `MarketFilter` and hands it back. Every consumer pushes that into
 * a server-side query — a chip that quietly did a client-side `.filter()` would be filtering the
 * first 1,000 rows of 27,629 (`PGRST_DB_MAX_ROWS`) and reporting it as the whole answer.
 */
import { memo, useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Chip, Collapsible, Text } from '@/components/ui';
import {
  activeFilterCount,
  CAP_BAND_LABELS,
  CAP_BANDS,
  STYLE_LABELS,
  STYLES,
  toggleFilterValue,
  type MarketFilter,
  type MarketFilterListKey,
} from './market-filter';

/** One selectable value: the code the server matches on, and what a person reads. */
export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroupSpec {
  key: MarketFilterListKey;
  title: string;
  options: FilterOption[];
}

interface FilterBarProps {
  filter: MarketFilter;
  onChange: (next: MarketFilter) => void;
  /**
   * Extra dimensions whose vocabulary the caller knows (sectors, countries, industries…).
   * Cap band and style are built in because their vocabularies are fixed by the schema.
   */
  groups?: FilterGroupSpec[];
  /** Hide the built-in style chips where style is meaningless — a bond list, say. */
  showStyle?: boolean;
  showCapBand?: boolean;
}

const FilterGroup = memo(function FilterGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: FilterOption[];
  selected: readonly string[] | undefined;
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <View className="mt-3">
      <Text variant="label">{title}</Text>
      {/* Horizontal scroll rather than wrap: a country group can hold 45 chips, and a wrapping
          row would push everything below it off the screen. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-1"
        contentContainerClassName="gap-2 pr-4"
      >
        {options.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            // `selected` undefined means NO OPINION — nothing is ticked, and the list is unfiltered
            // on this dimension. It must not render as "everything selected".
            active={selected?.includes(o.value) ?? false}
            onPress={() => onToggle(o.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
});

export function FilterBar({
  filter,
  onChange,
  groups = [],
  showStyle = true,
  showCapBand = true,
}: FilterBarProps) {
  const count = activeFilterCount(filter);

  const builtIn = useMemo<FilterGroupSpec[]>(() => {
    const out: FilterGroupSpec[] = [];
    if (showCapBand) {
      out.push({
        key: 'capBands',
        title: 'Size',
        options: CAP_BANDS.map((b) => ({ value: b, label: CAP_BAND_LABELS[b] })),
      });
    }
    if (showStyle) {
      out.push({
        key: 'styles',
        title: 'Style',
        options: STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })),
      });
    }
    return out;
  }, [showCapBand, showStyle]);

  const all = [...groups, ...builtIn];

  return (
    <Collapsible
      title="Filters"
      icon="filter"
      // The count is the whole affordance when collapsed: a filtered list that looks unfiltered is
      // how someone concludes the data is missing. An EMPTY dimension counts too — it constrains
      // the result to nothing, which is very much an opinion.
      meta={count > 0 ? `${count} active` : undefined}
      headerRight={
        count > 0 ? (
          <Button
            title="Clear"
            variant="ghost"
            size="sm"
            // Back to `{}` — no opinion on any dimension — never to a filter of empty arrays,
            // which would match nothing and read as "no results" instead of "no filter".
            onPress={() => onChange({})}
          />
        ) : undefined
      }
    >
      {all.map((g) => (
        <FilterGroup
          key={g.key}
          title={g.title}
          options={g.options}
          selected={filter[g.key] as readonly string[] | undefined}
          onToggle={(value) => onChange(toggleFilterValue(filter, g.key, value as never))}
        />
      ))}
    </Collapsible>
  );
}

/**
 * Coverage caveat for an aggregate.
 *
 * `aggregate_performance` returns `constituents`, `bucket_securities` and `weight_covered` with
 * every number precisely so a thin bucket cannot render like a thick one. Below the floor the
 * number is WITHHELD rather than shown small — a mean over 3 of 300 names is not that bucket's
 * return, and there is no typography that makes it one.
 */
export const COVERAGE_FLOOR = 0.5;

export function coverageNote(
  constituents: number,
  bucketSecurities: number,
  weightCovered: number | null,
): { show: boolean; note: string } {
  if (weightCovered !== null && weightCovered < COVERAGE_FLOOR) {
    return {
      show: false,
      note: `Covers only ${Math.round(weightCovered * 100)}% of this group by value`,
    };
  }
  const pct = weightCovered === null ? null : Math.round(weightCovered * 100);
  return {
    show: true,
    note:
      pct === null
        ? `${constituents} of ${bucketSecurities}`
        : `${constituents} of ${bucketSecurities} · ${pct}% by value`,
  };
}

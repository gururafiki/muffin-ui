/**
 * Search over a list that is ALREADY LOADED.
 *
 * Every list this is used on — countries in a region, sectors, a fund's holdings — is fetched whole
 * and held in memory, so filtering is a `useMemo` rather than a round trip per keystroke. That is
 * both faster and less to go wrong: no debounce, no loading state, no partial page.
 *
 * The one list this is NOT right for is the global security search, which spans 12,348 equities and
 * must ask the server (`use-security-search.ts`). The distinction is whether the caller already
 * holds everything it is filtering.
 */
import { useMemo, useState } from 'react';

import { Field } from '@/components/ui';

/** Below this a query matches most of a list and is not worth filtering on. */
const MIN_QUERY = 1;

export function useListSearch<T>(items: T[], toText: (item: T) => (string | null | undefined)[]) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < MIN_QUERY) return items;
    return items.filter((item) =>
      toText(item).some((field) => field?.toLowerCase().includes(needle)),
    );
    // `toText` is a fresh closure each render, so it is deliberately NOT a dependency — including
    // it would recompute on every render and defeat the memo. The items and the query are what
    // actually change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query]);

  return { query, setQuery, shown, filtering: query.trim().length >= MIN_QUERY };
}

export function ListSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <Field
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      accessibilityLabel={label}
      autoCorrect={false}
      autoCapitalize="none"
      className="mt-3"
    />
  );
}

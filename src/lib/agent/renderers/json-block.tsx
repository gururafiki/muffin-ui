import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui';
import { BOUND, sliceAtBoundary } from '@/lib/agent/bound-text';

/**
 * Last-resort renderer: pretty-printed JSON in a scrollable mono block.
 *
 * Bounded for the same reason `Markdown` is, and arguably more urgently: this
 * puts the WHOLE payload in a single `<Text>` inside a horizontal `ScrollView`,
 * so it never wraps and Android lays it out as one enormous line. A single huge
 * string is exactly what native text layout handles worst, and the tool-output
 * path (`tool-registry.tsx`) reaches here with whatever the backend returned.
 */
export function JsonBlock({ value }: { value: unknown }) {
  const [limit, setLimit] = useState(BOUND);
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  const over = text.length > limit;
  const shown = over ? sliceAtBoundary(text, limit) : text;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text variant="mono" className="text-xs text-ink-muted dark:text-night-text-muted">
          {shown}
        </Text>
      </ScrollView>
      {over ? (
        <Pressable
          onPress={() => setLimit((n) => n + BOUND)}
          accessibilityRole="button"
          accessibilityLabel={`Show more JSON, ${Math.round(limit / 1000)} of ${Math.round(text.length / 1000)} thousand characters shown`}
          className="self-start py-1 active:opacity-70">
          <Text variant="muted" className="text-[11px] text-frosting-500">
            {`Show more — ${Math.round(limit / 1000)}k of ${Math.round(text.length / 1000)}k shown`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

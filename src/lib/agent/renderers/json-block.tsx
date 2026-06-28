import { ScrollView } from 'react-native';

import { Text } from '@/components/ui';

/** Last-resort renderer: pretty-printed JSON in a scrollable mono block. */
export function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Text variant="mono" className="text-xs text-[#7A6A92] dark:text-night-text-muted">
        {text}
      </Text>
    </ScrollView>
  );
}

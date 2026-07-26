import { Pressable, View } from 'react-native';

import { Text } from './text';

/**
 * A pill-style segmented control — a horizontal row of mutually-exclusive
 * options, the selected one filled. Generic over a string id union. Promoted
 * from the Globe screen (the map scheme/lens switcher) into the `ui` barrel so
 * other surfaces (e.g. the run Overview/Execution-tree toggle) share one look.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            className={
              'rounded-pill border-2 px-3 py-1.5 active:opacity-80 ' +
              (active
                ? 'border-frosting-600 bg-frosting-500'
                : 'border-frosting-200 bg-white dark:border-night-border dark:bg-night-surface')
            }>
            <Text
              className={
                'font-heading text-sm ' +
                (active ? 'text-white' : 'text-frosting-600 dark:text-frosting-300')
              }>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

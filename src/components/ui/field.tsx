import { useColorScheme, TextInput, type TextInputProps, View } from 'react-native';

import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { Text } from './text';

type FieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  /** Inline validation message; when set the border turns to the error tone. */
  error?: string | null;
  /** Node pinned to the right inside the input (e.g. a password eye toggle). */
  rightSlot?: React.ReactNode;
  className?: string;
};

/** Labelled text input styled for the bakery theme. */
export function Field({ label, hint, error, rightSlot, className, ...props }: FieldProps) {
  const dark = useColorScheme() === 'dark';
  return (
    <View className="gap-1">
      {label ? <Text variant="label">{label}</Text> : null}
      <View className="justify-center">
        <TextInput
          placeholderTextColor={dark ? palette.night.textMuted : '#B6A8CC'}
          className={cn(
            'rounded-crumb border-2 border-frosting-200 bg-white px-3 py-3 font-body text-base text-ink',
            'dark:border-night-border dark:bg-night-surface dark:text-night-text',
            error && 'border-bearish',
            rightSlot && 'pr-11',
            className,
          )}
          {...props}
        />
        {rightSlot ? <View className="absolute right-2">{rightSlot}</View> : null}
      </View>
      {error ? (
        <Text className="text-sm text-bearish">{error}</Text>
      ) : hint ? (
        <Text variant="muted">{hint}</Text>
      ) : null}
    </View>
  );
}

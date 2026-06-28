import { useColorScheme, TextInput, type TextInputProps, View } from 'react-native';

import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { Text } from './text';

type FieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  className?: string;
};

/** Labelled text input styled for the bakery theme. */
export function Field({ label, hint, className, ...props }: FieldProps) {
  const dark = useColorScheme() === 'dark';
  return (
    <View className="gap-1">
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={dark ? palette.night.textMuted : '#B6A8CC'}
        className={cn(
          'rounded-crumb border-2 border-frosting-200 bg-white px-3 py-3 font-body text-base text-ink',
          'dark:border-night-border dark:bg-night-surface dark:text-night-text',
          className,
        )}
        {...props}
      />
      {hint ? <Text variant="muted">{hint}</Text> : null}
    </View>
  );
}

import { View } from 'react-native';

import { Chip, Collapsible, Field, Text } from '@/components/ui';
import type { AdvancedField } from '@/lib/agent/registry';
import type { OverrideValue } from '@/lib/agent/overrides';

/**
 * Collapsible "Advanced options" block: renders an agent's `advanced` fields as
 * per-run `configurable` overrides. Booleans use an on/off Chip, selects a Chip
 * row, numbers a numeric Field. Controlled — the parent owns the values and
 * passes them to `buildOverrides` when starting a run.
 */
export function AdvancedOptions({
  fields,
  values,
  onChange,
  title = 'Advanced options',
  defaultOpen = false,
}: {
  fields: AdvancedField[];
  values: Record<string, OverrideValue>;
  onChange: (key: string, value: OverrideValue) => void;
  title?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible title={title} icon="settings" defaultOpen={defaultOpen}>
      <View className="gap-3">
        {fields.map((f) => (
          <View key={f.key} className="gap-1">
            <Text variant="label">{f.label}</Text>

            {f.type === 'boolean' ? (
              <Chip
                label={values[f.key] === true ? 'On' : 'Off'}
                active={values[f.key] === true}
                onPress={() => onChange(f.key, !(values[f.key] === true))}
              />
            ) : f.type === 'select' ? (
              <View className="flex-row flex-wrap gap-2">
                {(f.options ?? []).map((opt) => (
                  <Chip
                    key={opt}
                    label={opt}
                    active={values[f.key] === opt}
                    onPress={() => onChange(f.key, values[f.key] === opt ? '' : opt)}
                  />
                ))}
              </View>
            ) : (
              <Field
                keyboardType="numeric"
                autoCapitalize="none"
                placeholder={f.placeholder}
                value={String(values[f.key] ?? '')}
                onChangeText={(v) => onChange(f.key, v)}
              />
            )}

            {f.hint ? <Text variant="muted">{f.hint}</Text> : null}
          </View>
        ))}
      </View>
    </Collapsible>
  );
}

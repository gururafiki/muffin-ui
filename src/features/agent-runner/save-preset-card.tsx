/**
 * "Save as preset" — save this graph + the current advanced options as a named
 * assistant (Agents tab). Self-contained: owns the name field and the create
 * mutation; only the non-secret configurable subset is stored server-side.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Collapsible, Field, Text } from '@/components/ui';
import { useCreatePreset } from '@/features/presets/use-presets';
import { buildOverrides, type OverrideValue } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { buildPresetConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

export function SavePresetCard({
  agent,
  advanced,
}: {
  agent: AgentDef;
  advanced: Record<string, OverrideValue>;
}) {
  const [presetName, setPresetName] = useState('');
  const createPreset = useCreatePreset();

  return (
    <Collapsible title="Save as preset" icon="sparkle">
      <View className="gap-2">
        <Text variant="muted">
          Save this graph + the current advanced options as a reusable assistant. API keys stay on
          this device — only non-secret settings are stored.
        </Text>
        <Field
          placeholder="Preset name"
          autoCapitalize="none"
          value={presetName}
          onChangeText={setPresetName}
        />
        <Button
          title="Save preset"
          variant="secondary"
          loading={createPreset.isPending}
          disabled={!presetName.trim() || createPreset.isPending}
          onPress={() =>
            createPreset.mutate(
              {
                graphId: agent.id,
                name: presetName.trim(),
                configurable: {
                  ...buildPresetConfigurable(getSettings()),
                  ...buildOverrides(agent.advanced, advanced),
                },
              },
              { onSuccess: () => setPresetName('') },
            )
          }
        />
        {createPreset.isSuccess ? <Text variant="muted">Preset saved ✓</Text> : null}
        {createPreset.isError ? (
          <Text variant="muted">Could not save preset — check the API URL / auth in Settings.</Text>
        ) : null}
      </View>
    </Collapsible>
  );
}

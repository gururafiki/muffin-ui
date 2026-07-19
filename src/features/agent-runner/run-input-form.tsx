/** The runner's input card: agent fields, advanced options, run/stop controls. */
import { ActivityIndicator, View } from 'react-native';

import { AdvancedOptions } from '@/components/advanced-options';
import { Button, Collapsible, Field, Text } from '@/components/ui';
import { SignInToRunNotice } from '@/features/account/run-gate';
import type { OverrideValue } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

export function RunInputForm({
  agent,
  values,
  onChangeField,
  advanced,
  onChangeAdvanced,
  hasResult,
  busy,
  hydrating,
  signInRequired,
  canRun,
  onRun,
  onStop,
}: {
  agent: AgentDef;
  values: Record<string, string>;
  onChangeField: (key: string, value: string) => void;
  advanced: Record<string, OverrideValue>;
  onChangeAdvanced: (key: string, value: OverrideValue) => void;
  hasResult: boolean;
  busy: boolean;
  hydrating: boolean;
  signInRequired: boolean;
  canRun: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  return (
    /* Inputs — collapsed once there is a result so the output leads. The key
       remounts the section when the result first lands (streamed live or
       hydrated from history), since defaultOpen is initial-only. */
    <Collapsible
      key={hasResult ? 'result' : 'fresh'}
      title={agent.title}
      icon={agent.icon}
      defaultOpen={!hasResult}
      headerRight={
        busy || hydrating ? <ActivityIndicator size="small" color={palette.frosting[400]} /> : undefined
      }>
      <View className="gap-3">
        <Text variant="muted">{agent.tagline}</Text>
        {agent.inputs.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            autoCapitalize={f.autoCapitalize}
            autoCorrect={false}
            value={values[f.key] ?? ''}
            onChangeText={(v) => onChangeField(f.key, v)}
          />
        ))}

        {agent.advanced?.length ? (
          <AdvancedOptions fields={agent.advanced} values={advanced} onChange={onChangeAdvanced} />
        ) : null}

        {signInRequired ? (
          <SignInToRunNotice />
        ) : (
          <>
            <Button
              title={busy ? 'Running…' : hasResult ? 'Run again' : 'Run agent'}
              loading={busy}
              disabled={!canRun || busy}
              onPress={onRun}
            />
            {busy ? <Button title="Stop" variant="ghost" onPress={onStop} /> : null}
          </>
        )}
      </View>
    </Collapsible>
  );
}

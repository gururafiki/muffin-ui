import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Collapsible, Field, Text } from '@/components/ui';
import { StructuredOutput } from '@/lib/agent/renderers';

type InterruptValue = unknown;

/** Pull a human-readable description out of a HITL interrupt payload, if any. */
function describeInterrupt(value: InterruptValue): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const d = v.description ?? v.message ?? v.question ?? v.action;
    if (typeof d === 'string') return d;
  }
  return undefined;
}

/**
 * Human-in-the-loop prompt. When the agent pauses with an interrupt, show its
 * proposed action and let the user Approve / Reject / Respond. The resume
 * payload shape is defined by the backend's HumanInTheLoopMiddleware, so we send
 * the common `{ type }` decisions and also expose a raw-JSON escape hatch for
 * exact control.
 */
export function InterruptCard({
  value,
  busy,
  onResume,
}: {
  value: InterruptValue;
  busy: boolean;
  onResume: (resume: unknown) => void;
}) {
  const [reply, setReply] = useState('');
  const [raw, setRaw] = useState('');
  const description = describeInterrupt(value);

  return (
    <Card tone="outline" className="gap-3">
      <Badge label="needs your input" tone="info" />
      {description ? (
        <Text variant="body">{description}</Text>
      ) : (
        <StructuredOutput value={value} />
      )}

      <View className="flex-row flex-wrap gap-2">
        <Button title="Approve" disabled={busy} onPress={() => onResume({ type: 'accept' })} />
        <Button title="Reject" variant="secondary" disabled={busy} onPress={() => onResume({ type: 'reject' })} />
      </View>

      <Field
        placeholder="Or type a response…"
        value={reply}
        onChangeText={setReply}
        multiline
      />
      <Button
        title="Send response"
        variant="butter"
        disabled={busy || !reply.trim()}
        onPress={() => onResume({ type: 'response', args: reply.trim() })}
      />

      <Collapsible title="Advanced: raw resume value">
        <Field placeholder='e.g. {"type":"edit","args":{...}}' value={raw} onChangeText={setRaw} multiline />
        <Button
          title="Resume with raw value"
          variant="ghost"
          disabled={busy || !raw.trim()}
          onPress={() => {
            try {
              onResume(JSON.parse(raw));
            } catch {
              onResume(raw);
            }
          }}
        />
      </Collapsible>
    </Card>
  );
}

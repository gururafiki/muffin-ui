/** The chat bubbles: the user's message and the assistant's answer card. */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Button, Card, Field, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { JsonBlock, Markdown, messageText, type AnyMessage } from '@/lib/agent/renderers';
import { palette } from '@/theme/colors';
import { tryParseJson, type MessageActions } from './conversation-turns';

function BranchControls({ message, actions }: { message: AnyMessage; actions: MessageActions }) {
  const b = actions.branchInfo?.(message);
  if (!b || b.total <= 1 || !actions.onSetBranch) return null;
  const onSetBranch = actions.onSetBranch;
  return (
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous branch"
        disabled={!b.prev}
        onPress={() => b.prev && onSetBranch(b.prev)}
        hitSlop={8}
        className="p-1 active:opacity-60">
        <Icon name="arrow-left" size={14} color={b.prev ? palette.frosting[400] : palette.frosting[200]} />
      </Pressable>
      <Text variant="muted" className="text-xs">{b.index + 1}/{b.total}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next branch"
        disabled={!b.next}
        onPress={() => b.next && onSetBranch(b.next)}
        hitSlop={8}
        className="p-1 active:opacity-60">
        <Icon name="arrow-right" size={14} color={b.next ? palette.frosting[400] : palette.frosting[200]} />
      </Pressable>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      className={cn('h-7 w-7 items-center justify-center active:opacity-60', disabled && 'opacity-40')}>
      <Icon name={icon} size={15} color={palette.frosting[400]} />
    </Pressable>
  );
}

export function HumanBubble({ message, actions }: { message: AnyMessage; actions?: MessageActions }) {
  const body = messageText(message.content);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);

  const onEdit = actions?.onEdit;

  if (editing && onEdit) {
    return (
      <Card tone="outline" className="gap-2">
        <Field value={text} onChangeText={setText} multiline autoFocus />
        <View className="flex-row gap-2">
          <Button title="Save & resend" size="sm" disabled={actions.busy || !text.trim()} onPress={() => { setEditing(false); onEdit(message, text.trim()); }} />
          <Button title="Cancel" size="sm" variant="ghost" onPress={() => setEditing(false)} />
        </View>
      </Card>
    );
  }

  return (
    <Card tone="outline" className="gap-1 self-end" style={{ maxWidth: '90%' }}>
      <Text variant="body">{body}</Text>
      {actions ? (
        <View className="flex-row items-center justify-end gap-0.5 pt-1">
          <BranchControls message={message} actions={actions} />
          <ActionBtn icon="copy" label="Copy message" onPress={() => actions.onCopy(body)} />
          {onEdit ? <ActionBtn icon="edit" label="Edit and resend" disabled={actions.busy} onPress={() => { setText(body); setEditing(true); }} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

export function AnswerBlock({ message, actions }: { message: AnyMessage; actions?: MessageActions }) {
  const body = messageText(message.content);
  // A model that answers with a raw JSON blob (some sub-agents do) should
  // render as pretty JSON, not an unformatted markdown wall — mirror ToolResult.
  const json = tryParseJson(body.trim());
  return (
    <Card tone="raised" className="gap-2">
      {json !== undefined ? <JsonBlock value={json} /> : <Markdown value={body} />}
      {actions ? (
        <View className="flex-row items-center justify-end gap-0.5 pt-1">
          <BranchControls message={message} actions={actions} />
          <ActionBtn icon="copy" label="Copy answer" onPress={() => actions.onCopy(body)} />
          {actions.onRegenerate ? <ActionBtn icon="regenerate" label="Regenerate answer" disabled={actions.busy} onPress={() => actions.onRegenerate!(message)} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

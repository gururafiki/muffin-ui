import { View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';

export type AnyMessage = {
  id?: string;
  type?: string;
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: { name?: string; args?: unknown; id?: string }[];
  status?: string;
  additional_kwargs?: Record<string, unknown>;
};

/** Flatten message content (string or content-blocks) to plain text. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .join('');
  }
  return '';
}

/** Normalised message kind: 'human' | 'ai' | 'tool'. */
export function messageKind(message: AnyMessage): string {
  return (message.type ?? message.role ?? 'ai').toLowerCase();
}

/** Parse a whole body as JSON when it looks like one (mirrors ToolResult). */
function tryParseJson(t: string): unknown {
  if (!(t.startsWith('{') || t.startsWith('[')) || t.length >= 8000) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

const textContent = messageText;

/** Render a single LangChain message (human / ai / tool). */
export function MessageBubble({ message }: { message: AnyMessage }) {
  const kind = (message.type ?? message.role ?? 'ai').toLowerCase();
  const body = textContent(message.content);
  const toolCalls = message.tool_calls ?? [];

  if (kind === 'tool') {
    const isError = message.status === 'error';
    const label = `tool · ${message.name ?? 'result'}${isError ? ' · error' : ''}`;
    return (
      <Card tone="muted" className="gap-1">
        <Badge label={label} tone={isError ? 'bearish' : 'info'} />
        {body ? <Text variant="mono" className="text-xs">{body.slice(0, 1200)}</Text> : null}
      </Card>
    );
  }

  const isHuman = kind === 'human' || kind === 'user';
  const json = isHuman ? undefined : tryParseJson(body.trim());
  return (
    <Card tone={isHuman ? 'outline' : 'raised'} className="gap-2">
      <Badge label={isHuman ? 'you' : (message.name ?? 'agent')} tone="info" />
      {body ? (
        isHuman ? (
          <Text variant="body">{body}</Text>
        ) : json !== undefined ? (
          <JsonBlock value={json} />
        ) : (
          <Markdown value={body} />
        )
      ) : null}
      {toolCalls.length > 0 && (
        <View className="gap-1">
          {toolCalls.map((tc, i) => (
            <View key={i} className="rounded-crumb bg-frosting-50 p-2 dark:bg-night-surface-muted">
              <Text variant="label">calls {tc.name}</Text>
              <JsonBlock value={tc.args} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Render an array of messages, if a state value is message-shaped. */
export function MessageList({ messages }: { messages: AnyMessage[] }) {
  return (
    <View className="gap-2">
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
    </View>
  );
}

export function isMessageArray(value: unknown): value is AnyMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'object' && v !== null && ('type' in v || 'role' in v))
  );
}

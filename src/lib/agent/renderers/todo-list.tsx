import { ActivityIndicator, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Card, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';

export type Todo = { content?: string; activeForm?: string; status?: string };

/** True when a value looks like a deep-agent to-do list (`write_todos` / state). */
export function isTodoList(value: unknown): value is Todo[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (t) => typeof t === 'object' && t !== null && ('content' in t || 'activeForm' in t) && 'status' in t,
    )
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const status = (todo.status ?? 'pending').toLowerCase();
  const done = status === 'completed' || status === 'done';
  const active = status === 'in_progress' || status === 'in-progress' || status === 'active';
  const label = (active && todo.activeForm) || todo.content || todo.activeForm || '';

  return (
    <View className="flex-row items-start gap-2">
      <View className="mt-0.5 h-4 w-4 items-center justify-center">
        {done ? (
          <Icon name="check-circle" size={16} color={palette.leaf[500]} weight="fill" />
        ) : active ? (
          <ActivityIndicator size="small" color={palette.butter[500]} />
        ) : (
          <View className="h-3.5 w-3.5 rounded-pill border-2 border-frosting-300 dark:border-night-border" />
        )}
      </View>
      <Text
        variant="body"
        className={cn('flex-1 text-sm', done && 'text-ink-soft line-through', active && 'font-heading')}>
        {label}
      </Text>
    </View>
  );
}

/** Render a deep-agent to-do list as a checklist with a done/total header. */
export function TodoList({ todos, title = 'To-dos' }: { todos: Todo[]; title?: string }) {
  const done = todos.filter((t) => {
    const s = (t.status ?? '').toLowerCase();
    return s === 'completed' || s === 'done';
  }).length;

  return (
    <Card tone="muted" className="gap-2">
      {/* `title=""` suppresses the header entirely — used where the caller's own facet
          heading already names and counts the plan. */}
      {title ? (
        <View className="flex-row items-center justify-between">
          <Text variant="label">{title}</Text>
          <Text variant="muted" className="text-xs">
            {done}/{todos.length} done
          </Text>
        </View>
      ) : null}
      <View className="gap-1.5">
        {todos.map((t, i) => (
          <TodoRow key={i} todo={t} />
        ))}
      </View>
    </Card>
  );
}

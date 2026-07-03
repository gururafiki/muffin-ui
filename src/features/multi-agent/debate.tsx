import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Avatar, Card, Text, type Signal } from '@/components/ui';
import { cn } from '@/lib/cn';
// Direct import (not the renderers barrel) to avoid a require cycle with
// trading-result.tsx, which lives in that barrel and renders this component.
import { Markdown } from '@/lib/agent/renderers/markdown';
import { palette } from '@/theme/colors';

/**
 * A voice in a debate. `side` controls bubble alignment so opposing views
 * literally face each other; `tone` colours the speaker's accent.
 */
export interface Debater {
  id: string;
  name: string;
  tone: Signal;
  icon?: IconName;
  side: 'left' | 'right';
}

export interface DebateTurn {
  speaker: string; // Debater id
  text: string;
}

const toneAccent: Record<Signal, { border: string; chip: string; text: string }> = {
  bullish: { border: 'border-bullish/40', chip: 'bg-bullish/15', text: 'text-bullish' },
  bearish: { border: 'border-bearish/40', chip: 'bg-bearish/15', text: 'text-bearish' },
  neutral: { border: 'border-butter-500/40', chip: 'bg-butter-400/20', text: 'text-butter-600' },
  info: { border: 'border-frosting-300', chip: 'bg-frosting-100', text: 'text-frosting-600' },
};

function TurnBubble({ debater, text }: { debater: Debater; text: string }) {
  const acc = toneAccent[debater.tone];
  const right = debater.side === 'right';
  return (
    <View className={cn('w-full flex-row gap-2', right && 'flex-row-reverse')}>
      <View className="pt-1">
        <Avatar name={debater.name} size={28} />
      </View>
      <View
        className={cn(
          'max-w-[85%] flex-1 rounded-muffin border-2 bg-white p-3 dark:bg-night-surface',
          right ? 'rounded-tr-crumb' : 'rounded-tl-crumb',
          acc.border,
        )}>
        <View className={cn('mb-1 flex-row items-center gap-1.5', right && 'justify-end')}>
          {debater.icon ? <Icon name={debater.icon} size={13} color={palette.frosting[500]} /> : null}
          <Text className={cn('font-heading text-xs uppercase tracking-wide', acc.text)}>{debater.name}</Text>
        </View>
        <Markdown value={text} />
      </View>
    </View>
  );
}

/**
 * A multi-agent debate as an actual conversation — opposing voices face each
 * other as chat bubbles. Collapsed to the opening exchange; "N more turns"
 * reveals the rest. Generic over muffin's multi_agent debates (bull vs bear,
 * risk debators, …).
 */
export function DebateView({
  title,
  icon,
  debaters,
  turns,
  initiallyVisible = 2,
}: {
  title: string;
  icon?: IconName;
  debaters: Debater[];
  turns: DebateTurn[];
  initiallyVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (turns.length === 0) return null;
  const byId = new Map(debaters.map((d) => [d.id, d]));
  const shown = expanded ? turns : turns.slice(0, initiallyVisible);
  const hidden = turns.length - shown.length;

  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-2">
        {icon ? <Icon name={icon} size={15} color={palette.frosting[500]} /> : null}
        <Text variant="label" className="flex-1">{title}</Text>
        <Text variant="muted" className="text-xs">{turns.length} turns</Text>
      </View>
      <View className="gap-3">
        {shown.map((t, i) => {
          const d = byId.get(t.speaker);
          if (!d) return null;
          return <TurnBubble key={i} debater={d} text={t.text} />;
        })}
      </View>
      {hidden > 0 ? (
        <Pressable onPress={() => setExpanded(true)} className="items-center py-1 active:opacity-70">
          <Text className="font-heading text-sm text-frosting-600 dark:text-frosting-300">
            Show {hidden} more turn{hidden > 1 ? 's' : ''} ↓
          </Text>
        </Pressable>
      ) : expanded && turns.length > initiallyVisible ? (
        <Pressable onPress={() => setExpanded(false)} className="items-center py-1 active:opacity-70">
          <Text className="font-heading text-sm text-frosting-600 dark:text-frosting-300">Collapse ↑</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

// ── Shapers for muffin's known debates ──────────────────────────────────

/** Interleave bull/bear round arrays into debate turns (bull opens each round). */
export function bullBearTurns(bull: unknown, bear: unknown): DebateTurn[] {
  const b = Array.isArray(bull) ? bull : [];
  const r = Array.isArray(bear) ? bear : [];
  const turns: DebateTurn[] = [];
  for (let i = 0; i < Math.max(b.length, r.length); i++) {
    if (typeof b[i] === 'string' && b[i]) turns.push({ speaker: 'bull', text: b[i] as string });
    if (typeof r[i] === 'string' && r[i]) turns.push({ speaker: 'bear', text: r[i] as string });
  }
  return turns;
}

export const BULL_BEAR_DEBATERS: Debater[] = [
  { id: 'bull', name: 'Bull', tone: 'bullish', icon: 'trend-up', side: 'left' },
  { id: 'bear', name: 'Bear', tone: 'bearish', icon: 'trend-down', side: 'right' },
];

/** Turns from LangChain messages carrying a `name` (risk debators). */
export function namedMessageTurns(messages: unknown): DebateTurn[] {
  if (!Array.isArray(messages)) return [];
  const turns: DebateTurn[] = [];
  for (const m of messages) {
    const name = (m as { name?: string })?.name ?? '';
    const content = (m as { content?: unknown })?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((c) => (typeof c === 'string' ? c : (c as { text?: string })?.text ?? '')).join('')
          : '';
    if (name && text) turns.push({ speaker: name, text });
  }
  return turns;
}

export const RISK_DEBATERS: Debater[] = [
  { id: 'aggressive_debator', name: 'Aggressive', tone: 'bearish', icon: 'trend-up', side: 'left' },
  { id: 'conservative_debator', name: 'Conservative', tone: 'info', icon: 'account-other', side: 'right' },
  { id: 'neutral_debator', name: 'Neutral', tone: 'neutral', icon: 'council', side: 'left' },
];

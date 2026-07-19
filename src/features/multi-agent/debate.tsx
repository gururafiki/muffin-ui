import { View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Avatar, Card, Collapsible, Text, type Signal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { titleCase } from '@/lib/format';
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
 * other as chat bubbles. Collapsed by default (standard `Collapsible`, same
 * pattern as the "Tool execution" panel); expanding reveals every turn.
 * Generic over muffin's multi_agent debates (bull vs bear, risk debators, …).
 */
export function DebateView({
  title,
  icon,
  debaters,
  turns,
  defaultOpen = false,
}: {
  title: string;
  icon?: IconName;
  debaters: Debater[];
  turns: DebateTurn[];
  defaultOpen?: boolean;
}) {
  if (turns.length === 0) return null;
  const byId = new Map(debaters.map((d) => [d.id, d]));

  return (
    <Card tone="muted" className="gap-2">
      <Collapsible
        title={title}
        icon={icon}
        meta={`${turns.length} turn${turns.length === 1 ? '' : 's'}`}
        defaultOpen={defaultOpen}
      >
        <View className="gap-3 pt-1">
          {turns.map((t, i) => {
            const d = byId.get(t.speaker);
            if (!d) return null;
            return <TurnBubble key={i} debater={d} text={t.text} />;
          })}
        </View>
      </Collapsible>
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

/** Turns from LangChain messages carrying a `name` (conference debaters). */
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

/**
 * Presentation for a debater, matched by fuzzy speaker name so it works across
 * the conference speaker ids (`bull_researcher` / `aggressive_debator` / …),
 * the legacy short ids (`bull` / `bear`), and any future roles.
 */
const DEBATER_STYLE: { match: RegExp; style: Omit<Debater, 'id'> }[] = [
  { match: /bull/i, style: { name: 'Bull', tone: 'bullish', icon: 'trend-up', side: 'left' } },
  { match: /bear/i, style: { name: 'Bear', tone: 'bearish', icon: 'trend-down', side: 'right' } },
  { match: /aggress/i, style: { name: 'Aggressive', tone: 'bearish', icon: 'trend-up', side: 'left' } },
  { match: /conserv/i, style: { name: 'Conservative', tone: 'info', icon: 'account-other', side: 'right' } },
  { match: /neutral/i, style: { name: 'Neutral', tone: 'neutral', icon: 'council', side: 'left' } },
];

function styleFor(speaker: string, index: number): Omit<Debater, 'id'> {
  const hit = DEBATER_STYLE.find((d) => d.match.test(speaker));
  if (hit) return hit.style;
  return { name: titleCase(speaker), tone: 'info', side: index % 2 === 0 ? 'left' : 'right' };
}

/**
 * Build the `Debater[]` for a set of turns, deriving each debater's `id` from
 * the actual `speaker` on the turns so bubbles always resolve — regardless of
 * whether the turns came from a conference message list or the legacy lists.
 */
export function debatersForTurns(turns: DebateTurn[]): Debater[] {
  const byId = new Map<string, Debater>();
  for (const t of turns) {
    if (!byId.has(t.speaker)) byId.set(t.speaker, { id: t.speaker, ...styleFor(t.speaker, byId.size) });
  }
  return [...byId.values()];
}

/** Shared council types + helpers (used by the arena, avatars, vote bar, judge). */

export type PersonaStage =
  | 'pending'
  | 'thinking'
  | 'collecting'
  | 'scoring'
  | 'deciding'
  | 'done';

/** One member's verdict — validated at the stream boundary (see schemas.ts). */
export type { PersonaSignal } from '@/lib/agent/schemas';

export type VoteTally = { bullish: number; bearish: number; neutral: number };

/** Bucket a persona's free-text signal into the three vote colours. */
export function signalTone(signal?: string): keyof VoteTally {
  const v = (signal ?? '').toLowerCase();
  if (/buy|bull|positive|outperform|accumulate/.test(v)) return 'bullish';
  if (/sell|bear|negative|underperform|reduce/.test(v)) return 'bearish';
  return 'neutral';
}

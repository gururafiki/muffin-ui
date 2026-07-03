/** Shared council types + helpers (used by the arena, avatars, vote bar, judge). */

export type PersonaStage =
  | 'pending'
  | 'thinking'
  | 'collecting'
  | 'scoring'
  | 'deciding'
  | 'done';

export interface PersonaSignal {
  agent_id?: string;
  signal?: string;
  confidence?: number;
  reasoning?: string;
  evidence?: Record<string, unknown>;
}

export type VoteTally = { bullish: number; bearish: number; neutral: number };

/** Bucket a persona's free-text signal into the three vote colours. */
export function signalTone(signal?: string): keyof VoteTally {
  const v = (signal ?? '').toLowerCase();
  if (/buy|bull|positive|outperform|accumulate/.test(v)) return 'bullish';
  if (/sell|bear|negative|underperform|reduce/.test(v)) return 'bearish';
  return 'neutral';
}

/** Persona subgraph node → live stage (collect_data → compute_evidence → …). */
export const SUBNODE_STAGE: Record<string, PersonaStage> = {
  collect_data: 'collecting',
  compute_evidence: 'scoring',
  render_verdict: 'deciding',
};

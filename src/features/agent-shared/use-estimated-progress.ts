import { useEffect, useState } from 'react';

/**
 * Eased, *honest* progress for an opaque wait that has no server-side
 * percent-complete signal — chiefly the 28–70s thread-hydration `getState`
 * (checkpoint-read latency on the Oracle node; see CLAUDE.md). The backend
 * never reports how far along the read is, so this is a time heuristic, not a
 * real measurement: the bar rises from 0, decelerates as it approaches a
 * typical duration, and *holds near the top* rather than ever reaching 1 — so
 * it can't claim to be done before the data actually lands. When the wait ends
 * the consumer unmounts, so there's no false "100%" to reconcile.
 *
 * Returns the 0..1 `value` plus a friendly `remainingLabel` ("~Ns left", then
 * "Almost there…" once past the estimate — never a negative countdown).
 *
 * `estimateMs` is a fixed shared constant today; learning it from recent
 * on-device load times is a noted roadmap follow-up, deliberately not built.
 */
export function useEstimatedProgress({
  estimateMs = 45_000,
  active = true,
  tickMs = 250,
}: { estimateMs?: number; active?: boolean; tickMs?: number } = {}): {
  value: number;
  remainingLabel: string;
} {
  // `elapsed` only ever moves via the interval callback (an external clock) —
  // never a synchronous setState in render/effect — and the start time is read
  // inside the effect, so both React-Compiler purity rules stay satisfied. The
  // card mounts fresh per hydration and unmounts when it ends, so a plain
  // `useState(0)` start is correct (no cross-run carryover to reset).
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), tickMs);
    return () => clearInterval(id);
  }, [active, tickMs]);

  // 1 − e^(−t / (estimate/2)) → ~0.86 at the estimate, hitting the 0.95 cap
  // around 1.5× the estimate and holding there, so a slow load still looks
  // alive without the bar ever completing.
  const value = Math.min(0.95, 1 - Math.exp(-elapsed / (estimateMs * 0.5)));

  const remainingMs = Math.max(0, estimateMs - elapsed);
  const remainingLabel = remainingMs > 0 ? `~${Math.ceil(remainingMs / 1000)}s left` : 'Almost there…';

  return { value, remainingLabel };
}

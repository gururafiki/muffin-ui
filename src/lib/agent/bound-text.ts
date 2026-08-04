/**
 * How much text is turned into views at once, and how much each "Show more" adds.
 *
 * Deliberately generous: a long analyst report or debate turn is a few KB, so
 * nothing a graph legitimately produces is ever truncated. Only pathological
 * payloads are affected.
 *
 * WHY A BOUND EXISTS AT ALL: `Markdown` parses its whole input into an element
 * tree, and every element becomes a shadow node + a Yoga node + a native text
 * layout. That work lives in the NATIVE heap — measured at 277 MB of a 412 MB
 * process on one trading run — and a failed native allocation calls `abort()`,
 * killing the app instantly with no dialog rather than throwing something
 * catchable.
 *
 * A backend defect once produced three ~200 KB debate turns of newline noise
 * (`risk_debate_messages`: 753 KB over 15 turns, against 26 KB for the
 * bull/bear debate). Expanding them cost +100 MB transient on an emulator that
 * survived; the same run closed a Pixel 10 Pro straight to the home screen.
 *
 * **Bounding must slice the STRING, not the box.** Clipping with `maxHeight` +
 * `overflow: hidden` — what this app's one previous clamp did — still renders
 * and lays out every element, so it buys nothing. Same reason a fixed-height
 * container is not a memory fix.
 *
 * Kept free of React Native imports so the offline check
 * (`scripts/run-timeline-check.ts`, `npm run verify:offline`) can exercise the
 * real function in Node.
 */
export const BOUND = 12_000;

/**
 * The first `limit` characters, cut on a line boundary so a slice never lands
 * mid-fence or mid-table and render as broken markup.
 *
 * Falls back to a hard cut when the boundary would throw away more than half the
 * budget — which is exactly the pathological single-line case that motivated
 * this, where there is no newline to cut on at all.
 */
export function sliceAtBoundary(text: string, limit: number = BOUND): string {
  if (text.length <= limit) return text;
  const hard = text.slice(0, limit);
  const nl = hard.lastIndexOf('\n');
  return nl > limit * 0.5 ? hard.slice(0, nl) : hard;
}

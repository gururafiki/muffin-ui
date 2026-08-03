/**
 * When does a run screen show its landing hero (the composer + examples) rather
 * than the run view (recap, error card, results/timeline)?
 *
 * This is one shared predicate because it was previously inlined in BOTH
 * `AgentRunner` and `CouncilScreen`, and both got it wrong the same way: they
 * tested the MOUNT-TIME `threadId` prop, which is `undefined` for the whole life
 * of a fresh run, and never the LIVE thread id that `onThreadId` sets the moment
 * a run is submitted.
 *
 * That reads correctly only while a run is producing something. The moment a
 * submitted run ends WITHOUT output — it errored, the user pressed Stop, or it
 * finished with an empty `resultKey` — `busy` goes false and `hasOutput` is
 * still false, so every guard was false and the screen silently fell back to the
 * landing hero. The run vanished mid-flight, and `<RunErrorCard>` (rendered just
 * below, and the one thing that could have explained why) became unreachable.
 * Observed on Android against the deployed API: a research run whose classifier
 * node failed streamed live for ~40s, then the screen reverted to an empty
 * composer with no error shown.
 *
 * The fix is to treat "a thread exists" as disqualifying, from either source:
 * once a run has a thread, this screen is about that run. Pressing "Start a new
 * run" is unaffected — `RunRecap` navigates to a fresh `/agents/[assistantId]`
 * route, which remounts the screen and resets both ids.
 */
export function showsLandingHero(state: {
  /** `threadId` prop — pinned at mount, set only when REOPENING a past run. */
  pinnedThreadId?: string;
  /** `useRunStream`'s live id — set by `onThreadId` as soon as a run starts. */
  liveThreadId?: string;
  /** `stream.isLoading` — a run is currently executing. */
  busy: boolean;
  /** The screen's notion of a result (a `resultKey` value, council votes, …). */
  hasOutput: boolean;
  /** `stream.isThreadLoading` — the reopen hydration read is in flight. */
  hydrating: boolean;
}): boolean {
  return (
    !state.pinnedThreadId &&
    !state.liveThreadId &&
    !state.busy &&
    !state.hasOutput &&
    !state.hydrating
  );
}

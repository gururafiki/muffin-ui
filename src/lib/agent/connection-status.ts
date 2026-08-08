import { create } from 'zustand';

/**
 * Live connection state for the run stream.
 *
 * Written from two places, because the SDK exposes no on-open callback: the SSE
 * transport's `onReconnect` marks `reconnecting` before each retry, and the fetch
 * wrapper below marks `online` again as soon as a request actually succeeds.
 *
 * There is deliberately no `lost` state here. Attempt exhaustion is NOT observable —
 * `onReconnect` fires *before* each attempt and never after the last one fails; the
 * SDK closes the event queue with the error instead. So the run screens derive
 * "lost" from `stream.error` plus this status, rather than from a state nothing
 * could ever set.
 */
interface ConnectionState {
  status: 'online' | 'reconnecting';
  /** Which reconnect attempt is in flight (0 while online). */
  attempt: number;
}

export const useConnection = create<ConnectionState>(() => ({ status: 'online', attempt: 0 }));

export const setReconnecting = (attempt: number): void =>
  useConnection.setState({ status: 'reconnecting', attempt });

export const setOnline = (): void => useConnection.setState({ status: 'online', attempt: 0 });

/**
 * Wrap the fetch handed to the SSE transport so a successful response clears the
 * reconnecting state.
 *
 * Errors are re-thrown untouched: the SDK's reconnect loop is driven by them, so
 * swallowing one would strand the stream in `reconnecting` with nothing left to
 * retry it.
 */
export function withConnectionTracking(inner: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await inner(input, init);
    if (response.ok) setOnline();
    return response;
  }) as typeof fetch;
}

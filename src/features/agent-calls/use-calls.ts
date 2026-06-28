import { useQuery } from '@tanstack/react-query';

import { getThread, searchThreads } from './threads';

/** List past agent calls (threads) from the configured deployment. */
export function useCalls() {
  return useQuery({ queryKey: ['threads'], queryFn: searchThreads });
}

/** Fetch a single past call (thread) by id. */
export function useCall(threadId: string | undefined) {
  return useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => getThread(threadId as string),
    enabled: !!threadId,
  });
}

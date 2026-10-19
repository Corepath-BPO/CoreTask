import type { SearchKind } from '@coretask/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-client';

import { searchApi } from '../api/search.api';

/**
 * Results for a (debounced) term.
 *
 * The previous answer stays on screen while the next one loads, so typing one
 * more letter refines the list instead of blanking it between keystrokes.
 */
export function useSearch(
  workspaceId: string | undefined,
  term: string,
  kinds: readonly SearchKind[],
) {
  const trimmed = term.trim();

  return useQuery({
    queryKey: queryKeys.search.results(workspaceId ?? '', trimmed, kinds),
    queryFn: () =>
      searchApi.search(workspaceId as string, trimmed, kinds, kinds.length === 1 ? 15 : 5),
    enabled: Boolean(workspaceId) && trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

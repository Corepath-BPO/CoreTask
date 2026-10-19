import { ApiRoutes } from '@coretask/contracts';
import type { SearchKind, SearchResults } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const searchApi = {
  /** `types` travels as one comma-separated parameter — see the work-items client. */
  search: (
    workspaceId: string,
    query: string,
    kinds: readonly SearchKind[] = [],
    limit?: number,
  ): Promise<SearchResults> =>
    apiClient.get<SearchResults>(ApiRoutes.search(workspaceId), {
      params: {
        q: query,
        ...(kinds.length ? { types: kinds.join(',') } : {}),
        ...(limit ? { limit } : {}),
      },
    }),
};

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-client';

import { ssoApi } from '../api/sso.api';

/**
 * Which "Continue with…" buttons to show. A server's configuration changes
 * with a deploy, not while a page is open, so one answer per visit is plenty;
 * a failure just means no buttons, never an error on the sign-in page.
 */
export function useSsoProviders() {
  return useQuery({
    queryKey: queryKeys.sso.providers,
    queryFn: () => ssoApi.providers(),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

import { ApiRoutes, type SocialSsoProvider } from '@coretask/contracts';
import type {
  AddWorkspaceDomainPayload,
  LinkedIdentity,
  SamlConnection,
  SsoProviders,
  SsoRedirect,
  UpsertSamlConnectionPayload,
  WorkspaceDomain,
} from '@coretask/types';

import { env } from '@/app/config/env';
import { apiClient } from '@/lib/api/client';

/** An API address the browser is sent to, rather than one fetched: it answers with a redirect. */
function navigable(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return `${env.apiUrl}${path}${search ? `?${search}` : ''}`;
}

export const ssoApi = {
  /** Public: which buttons the sign-in page shows. */
  providers: (): Promise<SsoProviders> => apiClient.get<SsoProviders>(ApiRoutes.auth.sso.providers),

  /** Where "Continue with Google" goes; the API sends the browser on to the provider. */
  startUrl: (provider: SocialSsoProvider, redirect?: string): string =>
    navigable(ApiRoutes.auth.sso.start(provider), { redirect }),

  /** Where "Sign in with SSO" goes, by the workspace's slug or the person's work address. */
  samlStartUrl: (by: { workspace?: string; email?: string }, redirect?: string): string =>
    navigable(ApiRoutes.auth.sso.samlStart, { ...by, redirect }),

  identities: (): Promise<LinkedIdentity[]> =>
    apiClient.get<LinkedIdentity[]>(ApiRoutes.auth.sso.identities),

  /** The provider's page, to connect it to the signed-in account. */
  link: (provider: SocialSsoProvider): Promise<SsoRedirect> =>
    apiClient.post<SsoRedirect>(ApiRoutes.auth.sso.link(provider)),

  linkSaml: (workspaceId: string): Promise<SsoRedirect> =>
    apiClient.post<SsoRedirect>(ApiRoutes.auth.sso.samlLink(workspaceId)),

  unlink: (identityId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.auth.sso.identity(identityId)),

  /** Null while the workspace has none. */
  samlConnection: (workspaceId: string): Promise<SamlConnection | null> =>
    apiClient.get<SamlConnection | null>(ApiRoutes.workspaces.saml(workspaceId)),

  saveSamlConnection: (
    workspaceId: string,
    payload: UpsertSamlConnectionPayload,
  ): Promise<SamlConnection> =>
    apiClient.put<SamlConnection>(ApiRoutes.workspaces.saml(workspaceId), payload),

  deleteSamlConnection: (workspaceId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.workspaces.saml(workspaceId)),

  domains: (workspaceId: string): Promise<WorkspaceDomain[]> =>
    apiClient.get<WorkspaceDomain[]>(ApiRoutes.workspaces.domains(workspaceId)),

  addDomain: (workspaceId: string, payload: AddWorkspaceDomainPayload): Promise<WorkspaceDomain> =>
    apiClient.post<WorkspaceDomain>(ApiRoutes.workspaces.domains(workspaceId), payload),

  removeDomain: (workspaceId: string, domainId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.workspaces.domain(workspaceId, domainId)),

  verifyDomain: (workspaceId: string, domainId: string): Promise<WorkspaceDomain> =>
    apiClient.post<WorkspaceDomain>(ApiRoutes.workspaces.verifyDomain(workspaceId, domainId)),
};

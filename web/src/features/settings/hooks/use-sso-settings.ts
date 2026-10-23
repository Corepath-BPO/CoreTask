import type { SocialSsoProvider } from '@coretask/contracts';
import type { UpsertSamlConnectionPayload } from '@coretask/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ssoApi } from '@/features/auth/api/sso.api';
import { leaveFor } from '@/features/auth/lib/leave-for';
import { ApiError } from '@/lib/api/api-error';
import { queryKeys } from '@/lib/api/query-client';

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/** The Google, Microsoft and SAML accounts connected to the signed-in person's. */
export function useLinkedIdentities() {
  return useQuery({ queryKey: queryKeys.sso.identities, queryFn: () => ssoApi.identities() });
}

/** Off to the provider; it sends the browser back to Settings with `?ssoLinked=` or `?ssoError=`. */
export function useConnectProvider() {
  return useMutation({
    mutationFn: (provider: SocialSsoProvider) => ssoApi.link(provider),
    onSuccess: ({ url }) => leaveFor(url),
    onError: (error) => toast.error(messageOf(error, 'Could not start connecting. Try again.')),
  });
}

/** The same, through a workspace's own identity provider. */
export function useConnectSaml() {
  return useMutation({
    mutationFn: (workspaceId: string) => ssoApi.linkSaml(workspaceId),
    onSuccess: ({ url }) => leaveFor(url),
    onError: (error) => toast.error(messageOf(error, 'Could not start connecting. Try again.')),
  });
}

export function useDisconnectIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (identityId: string) => ssoApi.unlink(identityId),
    onSuccess: () => {
      toast.success('Disconnected.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.sso.identities });
    },
    onError: (error) => toast.error(messageOf(error, 'Could not disconnect it. Try again.')),
  });
}

export function useSamlConnection(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.sso.saml(workspaceId),
    queryFn: () => ssoApi.samlConnection(workspaceId),
    enabled,
  });
}

export function useSaveSamlConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertSamlConnectionPayload) =>
      ssoApi.saveSamlConnection(workspaceId, payload),
    onSuccess: (connection) => {
      queryClient.setQueryData(queryKeys.sso.saml(workspaceId), connection);
      toast.success(
        connection.enabled ? 'Single sign-on is on.' : 'Saved. Single sign-on is off for now.',
      );
    },
  });
}

export function useDeleteSamlConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ssoApi.deleteSamlConnection(workspaceId),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.sso.saml(workspaceId), null);
      toast.success('Single sign-on is removed.');
    },
    onError: (error) => toast.error(messageOf(error, 'Could not remove it. Try again.')),
  });
}

export function useWorkspaceDomains(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.sso.domains(workspaceId),
    queryFn: () => ssoApi.domains(workspaceId),
    enabled,
  });
}

export function useAddDomain(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) => ssoApi.addDomain(workspaceId, { domain }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.sso.domains(workspaceId) }),
  });
}

export function useRemoveDomain(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => ssoApi.removeDomain(workspaceId, domainId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.sso.domains(workspaceId) }),
    onError: (error) => toast.error(messageOf(error, 'Could not remove the domain. Try again.')),
  });
}

export function useVerifyDomain(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => ssoApi.verifyDomain(workspaceId, domainId),
    onSuccess: (domain) => {
      toast.success(`${domain.domain} is verified.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sso.domains(workspaceId) });
    },
    onError: (error) => toast.error(messageOf(error, 'Could not check the record. Try again.')),
  });
}

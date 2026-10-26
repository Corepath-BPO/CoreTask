import type { CreateTicketPayload, UpdateTicketPayload } from '@coretask/types';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { ticketsApi, type TicketListParams } from '../api/tickets.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Every ticket query for a workspace, plus the feeds a ticket change shows up in.
 *
 * Creating a ticket writes an activity line and can notify an assignee, so the
 * dashboard would otherwise show a stale feed next to a fresh queue.
 */
async function invalidateTickets(workspaceId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(workspaceId) }),
  ]);
}

export function useTickets(workspaceId: string | undefined, params: TicketListParams) {
  return useQuery({
    queryKey: queryKeys.tickets.list(workspaceId ?? '', params as Record<string, unknown>),
    queryFn: () => ticketsApi.list(workspaceId as string, params),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useTicketDetail(workspaceId: string | undefined, idOrKey: string | null) {
  return useQuery({
    queryKey: queryKeys.tickets.detail(workspaceId ?? '', idOrKey ?? ''),
    queryFn: () => ticketsApi.get(workspaceId as string, idOrKey as string),
    enabled: Boolean(workspaceId) && Boolean(idOrKey),
  });
}

export function useCreateTicket(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateTicketPayload) => ticketsApi.create(workspaceId as string, payload),
    onSuccess: async (ticket) => {
      await invalidateTickets(workspaceId as string);
      // The key is the useful part: it is what gets pasted into chat and commits.
      toast.success(`${ticket.key} reported`);
    },
    onError: (error) => reportError(error, 'Could not report the ticket.'),
  });
}

export function useUpdateTicket(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload: UpdateTicketPayload }) =>
      ticketsApi.update(workspaceId as string, idOrKey, payload),
    onSuccess: async (ticket) => {
      await invalidateTickets(workspaceId as string);
      // The detail dialog may be keyed by id or by key; refresh both spellings.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tickets.detail(workspaceId as string, ticket.key),
      });
    },
    onError: (error) => reportError(error, 'Could not update the ticket.'),
  });
}

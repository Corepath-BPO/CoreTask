import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateTicketPayload,
  Ticket,
  TicketDetail,
  TicketListMeta,
  UpdateTicketPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export interface TicketListParams {
  page?: number;
  limit?: number;
  projectId?: string;
  /** `me` resolves to the caller server-side. */
  assigneeId?: string;
  reporterId?: string;
  status?: string[];
  type?: string[];
  priority?: string[];
  severity?: string[];
  /** A key such as `CORE-1001` matches exactly; anything else matches the title. */
  search?: string;
  dueBefore?: string;
  includeClosed?: boolean;
}

export const ticketsApi = {
  list: (
    workspaceId: string,
    params: TicketListParams = {},
  ): Promise<{ items: Ticket[]; meta: TicketListMeta }> =>
    apiClient.getPaginated<Ticket, TicketListMeta>(ApiRoutes.tickets.list(workspaceId), {
      params,
      // Repeated keys (`?status=A&status=B`) rather than axios's bracket
      // notation, which the API does not parse.
      paramsSerializer: { indexes: null },
    }),

  get: (workspaceId: string, idOrKey: string): Promise<TicketDetail> =>
    apiClient.get<TicketDetail>(ApiRoutes.tickets.detail(workspaceId, idOrKey)),

  create: (workspaceId: string, payload: CreateTicketPayload): Promise<Ticket> =>
    apiClient.post<Ticket>(ApiRoutes.tickets.create(workspaceId), payload),

  update: (workspaceId: string, idOrKey: string, payload: UpdateTicketPayload): Promise<Ticket> =>
    apiClient.patch<Ticket>(ApiRoutes.tickets.update(workspaceId, idOrKey), payload),
};

import type { TicketListParams } from '../api/tickets.api';

/** Sentinels for the two filter options that are not themselves a value. */
export const ALL_STATUSES = '__all__';
export const OPEN_ONLY = '__open__';
export const ANY = '__all__';

export type TicketScope = 'all' | 'me' | 'reported';

export interface TicketFilterState {
  page: number;
  limit: number;
  scope: TicketScope;
  status: string;
  type: string;
  priority: string;
  search: string;
}

/**
 * Maps the filter bar onto query parameters.
 *
 * The status control is three-way and each branch means something different to
 * the API: "Open only" is the server's default and sends nothing, "All statuses"
 * has to opt in with `includeClosed`, and a named status filters to it. Getting
 * these confused silently shows the wrong rows, so the mapping is pinned by
 * tests rather than left inline in the page.
 */
export function buildTicketParams(state: TicketFilterState): TicketListParams {
  return {
    page: state.page,
    limit: state.limit,
    ...(state.scope === 'me' ? { assigneeId: 'me' } : {}),
    ...(state.scope === 'reported' ? { reporterId: 'me' } : {}),
    ...(state.status === ALL_STATUSES
      ? { includeClosed: true }
      : state.status === OPEN_ONLY
        ? {}
        : { status: [state.status] }),
    ...(state.type !== ANY ? { type: [state.type] } : {}),
    ...(state.priority !== ANY ? { priority: [state.priority] } : {}),
    ...(state.search ? { search: state.search } : {}),
  };
}

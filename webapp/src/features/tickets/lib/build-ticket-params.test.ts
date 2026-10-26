import { TicketPriority, TicketStatus, TicketType } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import {
  ALL_STATUSES,
  ANY,
  buildTicketParams,
  OPEN_ONLY,
  type TicketFilterState,
} from './build-ticket-params';

const BASE: TicketFilterState = {
  page: 1,
  limit: 25,
  scope: 'all',
  status: OPEN_ONLY,
  type: ANY,
  priority: ANY,
  search: '',
};

describe('buildTicketParams', () => {
  it('sends nothing about status by default, letting the server hide finished work', () => {
    const params = buildTicketParams(BASE);

    expect(params).not.toHaveProperty('status');
    expect(params).not.toHaveProperty('includeClosed');
  });

  it('opts in to closed tickets for "all statuses" rather than listing every value', () => {
    const params = buildTicketParams({ ...BASE, status: ALL_STATUSES });

    expect(params.includeClosed).toBe(true);
    expect(params).not.toHaveProperty('status');
  });

  it('filters to a single named status', () => {
    const params = buildTicketParams({ ...BASE, status: TicketStatus.TRIAGED });

    expect(params.status).toEqual([TicketStatus.TRIAGED]);
    expect(params).not.toHaveProperty('includeClosed');
  });

  /**
   * A named closed status has to survive on its own: the API skips its default
   * exclusion whenever an explicit status is given.
   */
  it('can filter to a closed status without also setting includeClosed', () => {
    const params = buildTicketParams({ ...BASE, status: TicketStatus.CLOSED });

    expect(params.status).toEqual([TicketStatus.CLOSED]);
    expect(params).not.toHaveProperty('includeClosed');
  });

  it('maps the three scopes onto the right person filter', () => {
    expect(buildTicketParams({ ...BASE, scope: 'all' })).not.toHaveProperty('assigneeId');

    expect(buildTicketParams({ ...BASE, scope: 'me' })).toMatchObject({ assigneeId: 'me' });

    const reported = buildTicketParams({ ...BASE, scope: 'reported' });
    expect(reported).toMatchObject({ reporterId: 'me' });
    expect(reported).not.toHaveProperty('assigneeId');
  });

  it('omits type and priority while they are unset', () => {
    const params = buildTicketParams(BASE);

    expect(params).not.toHaveProperty('type');
    expect(params).not.toHaveProperty('priority');
  });

  it('wraps type and priority as arrays, because the API takes lists', () => {
    const params = buildTicketParams({
      ...BASE,
      type: TicketType.INCIDENT,
      priority: TicketPriority.URGENT,
    });

    expect(params.type).toEqual([TicketType.INCIDENT]);
    expect(params.priority).toEqual([TicketPriority.URGENT]);
  });

  it('drops an empty search so a cleared box does not filter to nothing', () => {
    expect(buildTicketParams(BASE)).not.toHaveProperty('search');
    expect(buildTicketParams({ ...BASE, search: 'CORE-1001' })).toMatchObject({
      search: 'CORE-1001',
    });
  });

  it('carries paging through untouched', () => {
    expect(buildTicketParams({ ...BASE, page: 3, limit: 50 })).toMatchObject({
      page: 3,
      limit: 50,
    });
  });
});

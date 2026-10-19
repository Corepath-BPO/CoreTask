import { describe, expect, it } from 'vitest';

import {
  actionFitsTrigger,
  isTicketTrigger,
  ticketConditionHolds,
  ticketConditionProblem,
} from './automation-tickets.js';

const ticket = {
  type: 'BUG',
  priority: 'HIGH',
  severity: 'CRITICAL',
  status: 'OPEN',
  assigneeId: null,
};

describe('ticket rules', () => {
  it('knows which triggers are about tickets, and what their rules may do', () => {
    expect(isTicketTrigger('TICKET_CREATED')).toBe(true);
    expect(isTicketTrigger('TASK_CREATED')).toBe(false);
    expect(actionFitsTrigger('SET_TICKET_STATUS', 'TICKET_CREATED')).toBe(true);
    expect(actionFitsTrigger('ASSIGN_USER', 'TICKET_CREATED')).toBe(true);
    expect(actionFitsTrigger('CREATE_SUBTASK', 'TICKET_CREATED')).toBe(false);
    expect(actionFitsTrigger('SET_TICKET_STATUS', 'TASK_CREATED')).toBe(false);
    expect(actionFitsTrigger('CREATE_SUBTASK', 'TASK_CREATED')).toBe(true);
  });

  it('checks a ticket field against one value or several, in either vocabulary', () => {
    const holds = (config: Record<string, unknown>) => ticketConditionHolds(config, ticket);
    expect(holds({ field: 'ticket.type', operator: 'IS', value: 'BUG' })).toBe(true);
    expect(holds({ field: 'ticket.type', operator: 'EQUALS', value: 'BUG' })).toBe(true);
    expect(
      holds({ field: 'ticket.severity', operator: 'IS_ONE_OF', value: ['MAJOR', 'CRITICAL'] }),
    ).toBe(true);
    expect(holds({ field: 'ticket.priority', operator: 'IS_NOT', value: 'HIGH' })).toBe(false);
    expect(holds({ field: 'ticket.assignee', operator: 'IS_EMPTY' })).toBe(true);
    expect(holds({ field: 'ticket.assignee', operator: 'IS', value: 'u-1' })).toBe(false);
  });

  it('says what is unfinished, and never holds while it is', () => {
    expect(ticketConditionProblem({})).toMatch(/what about the ticket/);
    expect(ticketConditionProblem({ field: 'ticket.type', operator: 'IS' })).toMatch(/value/);
    expect(
      ticketConditionProblem({ field: 'ticket.type', operator: 'IS', value: 'PIZZA' }),
    ).toMatch(/not a value/);
    expect(
      ticketConditionHolds({ field: 'ticket.type', operator: 'IS', value: 'PIZZA' }, ticket),
    ).toBe(false);
  });
});

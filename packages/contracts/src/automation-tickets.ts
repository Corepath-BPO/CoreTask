/**
 * Rules about tickets — what a rule set off by a ticket may check and do.
 *
 * A ticket is not a task: it has a type, a severity, and statuses and
 * priorities of its own, and no subtasks or custom fields. So a ticket rule
 * draws on its own short list of actions, and checks the ticket by its own
 * fields — `ticket.type`, `ticket.priority` and so on — which the builder's
 * condition form handles like any other field.
 */
import { AutomationAction, AutomationTrigger } from './automation.js';
import { TICKET_PRIORITIES, TICKET_SEVERITIES, TICKET_STATUSES, TICKET_TYPES } from './enums.js';

/** Triggers whose subject is a ticket. */
export const TICKET_TRIGGERS: readonly string[] = [
  AutomationTrigger.TICKET_CREATED,
  AutomationTrigger.TICKET_STATUS_CHANGED,
];

export function isTicketTrigger(trigger: string | null | undefined): boolean {
  return Boolean(trigger && TICKET_TRIGGERS.includes(trigger));
}

/** Actions that only make sense on a ticket. */
export const TICKET_ONLY_ACTIONS: readonly string[] = [
  AutomationAction.SET_TICKET_STATUS,
  AutomationAction.SET_TICKET_PRIORITY,
];

/** Everything a ticket rule may do. */
export const TICKET_RULE_ACTIONS: readonly string[] = [
  ...TICKET_ONLY_ACTIONS,
  AutomationAction.ASSIGN_USER,
  AutomationAction.UNASSIGN_USER,
  AutomationAction.MOVE_TO_SECTION,
  AutomationAction.SET_DUE_DATE,
  AutomationAction.CLEAR_DUE_DATE,
  AutomationAction.ADD_COMMENT,
  AutomationAction.SEND_IN_APP_NOTIFICATION,
  AutomationAction.SEND_EMAIL,
  AutomationAction.ADD_REMOVE_COLLABORATORS,
  AutomationAction.CREATE_TASK,
];

/** Whether an action may sit in a rule with this trigger. */
export function actionFitsTrigger(action: string, trigger: string | null | undefined): boolean {
  if (isTicketTrigger(trigger)) return TICKET_RULE_ACTIONS.includes(action);
  return !TICKET_ONLY_ACTIONS.includes(action);
}

/** The ticket's fields a condition can check, under the keys conditions store. */
export const TicketConditionField = {
  TYPE: 'ticket.type',
  PRIORITY: 'ticket.priority',
  SEVERITY: 'ticket.severity',
  STATUS: 'ticket.status',
  ASSIGNEE: 'ticket.assignee',
} as const;
export type TicketConditionField = (typeof TicketConditionField)[keyof typeof TicketConditionField];
export const TICKET_CONDITION_FIELDS = Object.values(TicketConditionField);

export function isTicketConditionField(field: unknown): field is TicketConditionField {
  return TICKET_CONDITION_FIELDS.includes(field as TicketConditionField);
}

export const TICKET_CONDITION_FIELD_LABEL: Record<TicketConditionField, string> = {
  'ticket.type': 'Ticket type',
  'ticket.priority': 'Ticket priority',
  'ticket.severity': 'Ticket severity',
  'ticket.status': 'Ticket status',
  'ticket.assignee': 'Ticket assignee',
};

/** The values each enum field takes; the assignee is a member, so none here. */
export const TICKET_CONDITION_VALUES: Record<
  Exclude<TicketConditionField, 'ticket.assignee'>,
  readonly string[]
> = {
  'ticket.type': TICKET_TYPES,
  'ticket.priority': TICKET_PRIORITIES,
  'ticket.severity': TICKET_SEVERITIES,
  'ticket.status': TICKET_STATUSES,
};

/**
 * How a ticket field compares: the builder's names for a single select and
 * a person, and the query engine's older names for the same comparisons.
 */
const COMPARISON: Record<
  string,
  'IS' | 'IS_NOT' | 'IS_ONE_OF' | 'IS_NOT_ONE_OF' | 'IS_EMPTY' | 'IS_NOT_EMPTY'
> = {
  IS: 'IS',
  EQUALS: 'IS',
  INCLUDES: 'IS',
  IS_NOT: 'IS_NOT',
  NOT_EQUALS: 'IS_NOT',
  DOES_NOT_INCLUDE: 'IS_NOT',
  IS_ONE_OF: 'IS_ONE_OF',
  IN: 'IS_ONE_OF',
  IS_NOT_ONE_OF: 'IS_NOT_ONE_OF',
  NOT_IN: 'IS_NOT_ONE_OF',
  IS_EMPTY: 'IS_EMPTY',
  IS_NOT_EMPTY: 'IS_NOT_EMPTY',
};

/** The ticket as its conditions read it; an unset assignee is null. */
export interface TicketFacts {
  type: string;
  priority: string;
  severity: string;
  status: string;
  assigneeId: string | null;
}

const factOf = (field: TicketConditionField, ticket: TicketFacts): string | null => {
  switch (field) {
    case 'ticket.type':
      return ticket.type;
    case 'ticket.priority':
      return ticket.priority;
    case 'ticket.severity':
      return ticket.severity;
    case 'ticket.status':
      return ticket.status;
    case 'ticket.assignee':
      return ticket.assigneeId;
  }
};

/** What is wrong with a ticket condition's configuration, or null. */
export function ticketConditionProblem(config: Record<string, unknown>): string | null {
  const field = config['field'];
  if (!isTicketConditionField(field)) return 'Choose what about the ticket to check.';
  const comparison = COMPARISON[String(config['operator'] ?? '')];
  if (!comparison) return 'Choose how to compare it.';
  if (comparison === 'IS_EMPTY' || comparison === 'IS_NOT_EMPTY') return null;

  const value = config['value'];
  const values = Array.isArray(value) ? value : value ? [value] : [];
  if (values.length === 0) return 'Choose a value to compare against.';
  if (field !== 'ticket.assignee') {
    const known = TICKET_CONDITION_VALUES[field];
    if (values.some((entry) => !known.includes(String(entry)))) {
      return 'That is not a value this field takes.';
    }
  }
  return null;
}

/** Whether a ticket meets a ticket condition. Never holds while it is unfinished. */
export function ticketConditionHolds(
  config: Record<string, unknown>,
  ticket: TicketFacts,
): boolean {
  if (ticketConditionProblem(config)) return false;
  const actual = factOf(config['field'] as TicketConditionField, ticket);
  const value = config['value'];
  const wanted = (Array.isArray(value) ? value : value ? [value] : []).map(String);

  switch (COMPARISON[String(config['operator'])]) {
    case 'IS':
      return actual !== null && actual === wanted[0];
    case 'IS_NOT':
      return actual !== wanted[0];
    case 'IS_ONE_OF':
      return actual !== null && wanted.includes(actual);
    case 'IS_NOT_ONE_OF':
      return actual === null || !wanted.includes(actual);
    case 'IS_EMPTY':
      return actual === null;
    case 'IS_NOT_EMPTY':
      return actual !== null;
    default:
      return false;
  }
}

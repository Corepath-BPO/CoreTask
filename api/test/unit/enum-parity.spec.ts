import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITIES,
  NOTIFICATION_TYPES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  WORKSPACE_ROLES,
} from '@coretask/contracts';
import { $Enums } from '@prisma/client';

/**
 * `@coretask/contracts` cannot import Prisma — the web client consumes it — so
 * the enums are declared twice. This test is the guard rail: a value added to
 * the schema but not to the shared package fails the API suite instead of
 * silently producing a value the client cannot render.
 */
describe('shared enums match the Prisma schema', () => {
  const cases: [string, readonly string[], Record<string, string>][] = [
    ['WorkspaceRole', WORKSPACE_ROLES, $Enums.WorkspaceRole],
    ['ProjectStatus', PROJECT_STATUSES, $Enums.ProjectStatus],
    ['TaskPriority', TASK_PRIORITIES, $Enums.TaskPriority],
    ['TaskStatus', TASK_STATUSES, $Enums.TaskStatus],
    [
      'TicketType',
      ['BUG', 'FEATURE', 'SUPPORT', 'QUESTION', 'MAINTENANCE', 'INCIDENT'],
      $Enums.TicketType,
    ],
    ['TicketPriority', TICKET_PRIORITIES, $Enums.TicketPriority],
    ['TicketSeverity', TICKET_SEVERITIES, $Enums.TicketSeverity],
    ['TicketStatus', TICKET_STATUSES, $Enums.TicketStatus],
    ['NotificationType', NOTIFICATION_TYPES, $Enums.NotificationType],
    ['ActivityAction', ACTIVITY_ACTIONS, $Enums.ActivityAction],
    ['ActivityEntity', ACTIVITY_ENTITIES, $Enums.ActivityEntity],
  ];

  it.each(cases)('%s has identical members on both sides', (_name, shared, prismaEnum) => {
    expect([...shared].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});

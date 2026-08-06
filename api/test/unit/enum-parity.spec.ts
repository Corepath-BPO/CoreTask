import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITIES,
  ATTACHMENT_STATUSES,
  CREATABLE_WORK_ITEM_TYPES,
  AUTOMATION_EXECUTION_STATUSES,
  AUTOMATION_NODE_TYPES,
  AUTOMATION_RULE_STATUSES,
  CUSTOM_FIELD_TYPES,
  NOTIFICATION_TYPES,
  PROJECT_VIEW_SCOPES,
  PROJECT_VIEW_TYPES,
  PROJECT_STATUSES,
  STATUS_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
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
  const cases: [keyof typeof $Enums, readonly string[]][] = [
    ['WorkspaceRole', WORKSPACE_ROLES],
    ['ProjectStatus', PROJECT_STATUSES],
    ['TaskPriority', TASK_PRIORITIES],
    ['TaskStatus', TASK_STATUSES],
    ['TicketType', TICKET_TYPES],
    ['TicketPriority', TICKET_PRIORITIES],
    ['TicketSeverity', TICKET_SEVERITIES],
    ['TicketStatus', TICKET_STATUSES],
    ['NotificationType', NOTIFICATION_TYPES],
    ['ActivityAction', ACTIVITY_ACTIONS],
    ['ActivityEntity', ACTIVITY_ENTITIES],
    ['AttachmentStatus', ATTACHMENT_STATUSES],
    ['StatusCategory', STATUS_CATEGORIES],
    ['AutomationRuleStatus', AUTOMATION_RULE_STATUSES],
    ['AutomationNodeType', AUTOMATION_NODE_TYPES],
    ['AutomationExecutionStatus', AUTOMATION_EXECUTION_STATUSES],
    ['CustomFieldType', CUSTOM_FIELD_TYPES],
    ['ProjectViewType', PROJECT_VIEW_TYPES],
    ['ProjectViewScope', PROJECT_VIEW_SCOPES],
    ['CreatableWorkItemType', CREATABLE_WORK_ITEM_TYPES],
  ];

  it.each(cases)('%s has identical members on both sides', (name, shared) => {
    const prismaEnum = $Enums[name] as unknown as Record<string, string>;
    expect([...shared].sort()).toEqual(Object.values(prismaEnum).sort());
  });

  /*
   * The list above is written by hand, so on its own it only catches a new
   * *value* on an enum it already knows about — a whole new enum would simply
   * not be checked. This closes that: every enum Prisma generates must appear
   * above, so adding one to the schema and forgetting the shared package fails
   * here rather than at the point some client cannot render it.
   */
  it('covers every enum in the schema, so a new one cannot slip past', () => {
    expect(cases.map(([name]) => name).sort()).toEqual(Object.keys($Enums).sort());
  });
});

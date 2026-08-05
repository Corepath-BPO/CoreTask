import type { ProjectWorkItem } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { isTicketRow, rowPriorityId, rowStatusId, toWorkItemRow } from './work-item-row';

const base = (overrides: Partial<ProjectWorkItem> = {}): ProjectWorkItem =>
  ({
    id: 'w-1',
    type: 'TASK',
    workspaceId: 'ws-1',
    projectId: 'p-1',
    sectionId: 's-1',
    parentId: null,
    title: 'Ship the grid',
    description: null,
    position: 1000,
    status: { id: 'IN_PROGRESS', name: 'In Progress', colorToken: 'blue' },
    priority: { id: 'HIGH', name: 'High', colorToken: 'orange' },
    assignees: [],
    startDate: null,
    dueDate: null,
    completedAt: null,
    archivedAt: null,
    subtaskCount: 0,
    completedSubtaskCount: 0,
    customFieldValues: [],
    details: { kind: 'TASK', estimatedMinutes: null, rawStatus: 'TODO', rawPriority: 'MEDIUM' },
    createdById: 'u-1',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as ProjectWorkItem;

const ticket = (overrides: Partial<ProjectWorkItem> = {}): ProjectWorkItem =>
  base({
    id: 'w-2',
    type: 'TICKET',
    title: 'Login returns a 500',
    status: { id: 'TRIAGED', name: 'Triaged', colorToken: 'slate' },
    priority: { id: 'URGENT', name: 'Urgent', colorToken: 'red' },
    details: {
      kind: 'TICKET',
      key: 'CORE-1042',
      number: 1042,
      ticketType: 'BUG',
      severity: 'MAJOR',
      reporter: null,
      rawStatus: 'TRIAGED',
      rawPriority: 'URGENT',
      resolvedAt: null,
      closedAt: null,
    },
    ...overrides,
  });

describe('turning a work item into a row', () => {
  it('carries the item alongside, so a cell can ask what it really is', () => {
    // The row is Task-shaped for the cells that do not care. The ones that do —
    // status, priority — read the truth rather than inferring it from a shape a
    // ticket is only borrowing.
    const row = toWorkItemRow(ticket());

    expect(row.workItem.type).toBe('TICKET');
    expect(isTicketRow(row)).toBe(true);
    expect(isTicketRow(toWorkItemRow(base()))).toBe(false);
  });

  it('uses each kind’s raw enum, never the resolved state’s id', () => {
    /*
     * A task with a status *definition* resolves to a uuid id. Using it here
     * printed `019fce6b-…` in the status column, because the grid's badges
     * render a fixed set of enum values. Caught by looking at the screen; the
     * types were perfectly happy with it.
     */
    const row = toWorkItemRow(
      base({
        status: { id: '019fce6b-efa0-7f40-846a-98cb1196437f', name: 'To Do', colorToken: 'gray' },
        details: { kind: 'TASK', estimatedMinutes: null, rawStatus: 'TODO', rawPriority: 'HIGH' },
      }),
    );

    expect(row.status).toBe('TODO');
    expect(row.priority).toBe('HIGH');
  });

  it('gives a ticket its own status vocabulary, not a task-shaped guess', () => {
    /*
     * `TRIAGED` is not a TaskStatus. Rendering it through the task badge would
     * produce a colourless badge, and offering task statuses in its editor would
     * offer choices the API refuses.
     */
    const row = toWorkItemRow(ticket());

    expect(row.status).toBe('TRIAGED');
    expect(row.priority).toBe('URGENT');
  });

  it('reports the state id the API will accept back', () => {
    expect(rowStatusId(toWorkItemRow(ticket()))).toBe('TRIAGED');
    expect(rowPriorityId(toWorkItemRow(base()))).toBe('HIGH');
  });

  it('renames custom field values to what the grid reads', () => {
    // The wire says `textValue`; the List's value type says `text`. Both are
    // reasonable, so the translation is done once, here.
    const row = toWorkItemRow(
      base({
        customFieldValues: [
          {
            fieldId: 'f-1',
            textValue: 'Blocked on legal',
            numberValue: null,
            dateValue: null,
            booleanValue: null,
            optionIds: ['o-1'],
            userIds: [],
          },
        ],
      }),
    );

    expect(row.customFieldValues[0]).toEqual({
      customFieldId: 'f-1',
      text: 'Blocked on legal',
      number: null,
      date: null,
      checkbox: null,
      optionIds: ['o-1'],
      userIds: [],
    });
  });

  it('gives a ticket no custom field values rather than pretending', () => {
    // There is nowhere to store one yet. Empty is true; inventing a shape is not.
    expect(toWorkItemRow(ticket()).customFieldValues).toEqual([]);
  });

  it('takes the first assignee, because a Task holds one', () => {
    const row = toWorkItemRow(
      base({
        assignees: [
          { id: 'u-2', name: 'Maya', email: 'maya@example.com', avatarUrl: null },
          { id: 'u-3', name: 'Jonas', email: 'jonas@example.com', avatarUrl: null },
        ],
      }),
    );

    expect(row.assigneeId).toBe('u-2');
    expect(row.assignee?.name).toBe('Maya');
  });

  it('maps the parent, so subtasks still nest', () => {
    expect(toWorkItemRow(base({ parentId: 'w-parent' })).parentTaskId).toBe('w-parent');
  });

  it('keeps the position, which is what both views order by', () => {
    expect(toWorkItemRow(base({ position: 4500 })).position).toBe(4500);
  });

  it('reads an estimate from a task and never from a ticket', () => {
    expect(
      toWorkItemRow(
        base({
          details: { kind: 'TASK', estimatedMinutes: 90, rawStatus: 'TODO', rawPriority: 'MEDIUM' },
        }),
      ).estimatedMinutes,
    ).toBe(90);
    expect(toWorkItemRow(ticket()).estimatedMinutes).toBeNull();
  });
});

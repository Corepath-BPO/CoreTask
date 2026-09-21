import { CustomFieldType, TaskPriority, TaskStatus, WorkItemType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ProjectWorkItem } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { toWorkItemRow } from '@/features/work-items/lib/work-item-row';

import { groupRows } from './group-rows';
import { groupValueChange, isManualOrder } from './group-value';

const item = (overrides: Partial<ProjectWorkItem> & { id: string }): ProjectWorkItem => ({
  type: WorkItemType.TASK,
  workspaceId: 'ws-1',
  projectId: 'p-1',
  sectionId: 's-1',
  parentId: null,
  title: overrides.id,
  description: null,
  position: 1,
  status: { id: 'st-todo', name: 'To do', colorToken: 'gray' },
  priority: null,
  assignees: [],
  startDate: null,
  startAt: null,
  dueDate: null,
  dueAt: null,
  completedAt: null,
  archivedAt: null,
  subtaskCount: 0,
  completedSubtaskCount: 0,
  commentCount: 0,
  attachmentCount: 0,
  customFieldValues: [],
  details: {
    kind: 'TASK',
    estimatedMinutes: null,
    rawStatus: TaskStatus.TODO,
    rawPriority: TaskPriority.NONE,
  },
  createdById: 'u-1',
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const metadata: ProjectFieldMetadata = {
  customFields: [
    {
      id: 'f-sev',
      projectId: 'p-1',
      name: 'Severity',
      description: null,
      type: CustomFieldType.SINGLE_SELECT,
      isRequired: false,
      notifyOnChange: false,
      isArchived: false,
      position: 1,
      settings: {},
      options: [
        {
          id: 'o-low',
          label: 'Low',
          colorToken: 'blue',
          customColor: null,
          position: 1,
          isArchived: false,
        },
        {
          id: 'o-high',
          label: 'High',
          colorToken: 'red',
          customColor: null,
          position: 2,
          isArchived: false,
        },
        {
          id: 'o-old',
          label: 'Old',
          colorToken: 'gray',
          customColor: null,
          position: 3,
          isArchived: true,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  statuses: [
    { id: 'st-todo', name: 'To do', category: 'TODO', colorToken: 'gray' },
    { id: 'st-doing', name: 'Doing', category: 'IN_PROGRESS', colorToken: 'blue' },
  ],
  priorities: [],
  sections: [
    { id: 's-1', name: 'Backlog' },
    { id: 's-2', name: 'Done' },
  ],
  members: [
    { id: 'u-1', name: 'Ada', email: 'ada@x.dev', avatarUrl: null },
    { id: 'u-2', name: 'Grace', email: 'grace@x.dev', avatarUrl: null },
  ],
};

const rows = (...items: ProjectWorkItem[]) => items.map(toWorkItemRow);

describe('groupRows', () => {
  it('falls back to sections, every one of them, with orphans last', () => {
    const groups = groupRows(
      rows(item({ id: 'a' }), item({ id: 'b', sectionId: null })),
      null,
      metadata,
    );

    expect(groups.map((group) => group.name)).toEqual(['Backlog', 'Done', 'No section']);
    expect(groups.every((group) => group.kind === 'section')).toBe(true);
  });

  it('draws every status in the project’s order, empty or not, then the rest', () => {
    const groups = groupRows(
      rows(
        item({ id: 'a', status: { id: 'st-doing', name: 'Doing', colorToken: 'blue' } }),
        item({ id: 'k', status: { id: 'OPEN', name: 'Open', colorToken: 'gray' } }),
      ),
      'status',
      metadata,
    );

    expect(groups.map((group) => group.name)).toEqual(['To do', 'Doing', 'Open']);
    expect(groups[0]?.tasks).toHaveLength(0);
    // A ticket's own status is a heading too, not a dropped row.
    expect(groups[2]?.tasks.map((task) => task.id)).toEqual(['k']);
    expect(groups.every((group) => group.kind === 'value')).toBe(true);
  });

  it('groups by assignee with the unassigned last, named members first', () => {
    const groups = groupRows(
      rows(
        item({ id: 'g', assignees: [{ id: 'u-2', name: 'Grace', email: 'g', avatarUrl: null }] }),
        item({ id: 'a', assignees: [{ id: 'u-1', name: 'Ada', email: 'a', avatarUrl: null }] }),
        item({ id: 'n' }),
      ),
      'assigneeId',
      metadata,
    );

    expect(groups.map((group) => group.name)).toEqual(['Ada', 'Grace', 'Unassigned']);
    expect(groups[2]?.key).toBeNull();
  });

  it('groups by a single-select with every live option, then hidden ones in use, then none', () => {
    const value = (optionId: string) => [
      {
        fieldId: 'f-sev',
        textValue: null,
        numberValue: null,
        dateValue: null,
        booleanValue: null,
        optionIds: [optionId],
        userIds: [],
      },
    ];
    const groups = groupRows(
      rows(
        item({ id: 'h', customFieldValues: value('o-high') }),
        item({ id: 'o', customFieldValues: value('o-old') }),
        item({ id: 'n' }),
      ),
      'custom:f-sev',
      metadata,
    );

    expect(groups.map((group) => group.name)).toEqual([
      'Low',
      'High',
      'Old (hidden)',
      'No Severity',
    ]);
    expect(groups[0]?.tasks).toHaveLength(0);
    expect(groups[1]?.color?.colorToken).toBe('red');
    // Never a bare option id: the board's droppables share a context with card ids.
    expect(groups[1]?.id).toBe('custom:f-sev:o-high');
  });
});

describe('groupValueChange', () => {
  const task = rows(item({ id: 't' }))[0]!;
  const ticket = rows(
    item({
      id: 'k',
      type: WorkItemType.TICKET,
      details: {
        kind: 'TICKET',
        key: 'CORE-1',
        number: 1,
        ticketType: 'BUG',
        severity: 'MINOR',
        reporter: null,
        rawStatus: 'OPEN',
        rawPriority: 'LOW',
        resolvedAt: null,
        closedAt: null,
      } as ProjectWorkItem['details'],
    }),
  )[0]!;

  it('moves for a section group and edits for a value group', () => {
    expect(
      groupValueChange(
        null,
        { id: 's-2', key: 's-2', name: 'Done', kind: 'section', tasks: [] },
        task,
        metadata,
      ),
    ).toEqual({ kind: 'move', sectionId: 's-2' });
    expect(
      groupValueChange(
        'status',
        { id: 'status:st-doing', key: 'st-doing', name: 'Doing', kind: 'value', tasks: [] },
        task,
        metadata,
      ),
    ).toEqual({ kind: 'update', payload: { statusId: 'st-doing' } });
    expect(
      groupValueChange(
        'assigneeId',
        { id: 'assigneeId:__none__', key: null, name: 'Unassigned', kind: 'value', tasks: [] },
        task,
        metadata,
      ),
    ).toEqual({ kind: 'update', payload: { assigneeIds: [] } });
  });

  it('sets a custom field for a task and refuses it for a ticket', () => {
    const group = {
      id: 'custom:f-sev:o-high',
      key: 'o-high',
      name: 'High',
      kind: 'value' as const,
      tasks: [],
    };

    expect(groupValueChange('custom:f-sev', group, task, metadata)).toEqual({
      kind: 'field',
      fieldId: 'f-sev',
      payload: { optionIds: ['o-high'] },
    });
    expect(groupValueChange('custom:f-sev', group, ticket, metadata)).toMatchObject({
      kind: 'refused',
    });
  });
});

describe('isManualOrder', () => {
  it('holds only with no sort and the section grouping', () => {
    expect(isManualOrder({ sorts: [], groupBy: null })).toBe(true);
    expect(isManualOrder({ sorts: [], groupBy: 'sectionId' })).toBe(true);
    expect(isManualOrder({ sorts: [{ field: 'dueDate', direction: 'ASC' }], groupBy: null })).toBe(
      false,
    );
    expect(isManualOrder({ sorts: [], groupBy: 'status' })).toBe(false);
  });
});

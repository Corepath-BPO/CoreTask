import type { ActivityEntry } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { describeStory } from './story-text';

const entry = (
  action: ActivityEntry['action'],
  metadata: Record<string, unknown> | null,
  summary = 'Something happened',
): ActivityEntry => ({
  id: '019f0000-0000-7000-8000-000000000001',
  workspaceId: 'ws',
  action,
  entity: 'TASK',
  entityId: 'task',
  summary,
  metadata,
  actor: null,
  createdAt: '2026-09-10T10:00:00.000Z',
});

const ada = { id: 'ada', label: 'Ada Lovelace' };
const grace = { id: 'grace', label: 'Grace Hopper' };
const ctx = { itemWord: 'task' as const, meId: 'me' };

describe('describeStory', () => {
  it.each([
    [
      'ASSIGNED',
      { field: 'assignee', before: null, after: ada },
      'assigned this task to Ada Lovelace',
    ],
    [
      'ASSIGNED',
      { field: 'assignee', before: ada, after: { id: 'me', label: 'Me' } },
      'assigned this to you',
    ],
    ['UNASSIGNED', { field: 'assignee', before: ada, after: null }, 'unassigned Ada Lovelace'],
    [
      'STATUS_CHANGED',
      { field: 'completed', before: 'incomplete', after: 'complete' },
      'marked this task complete',
    ],
    [
      'STATUS_CHANGED',
      { field: 'completed', before: 'complete', after: 'incomplete' },
      'marked this task incomplete',
    ],
    [
      'STATUS_CHANGED',
      {
        field: 'status',
        before: { id: 'OPEN', label: 'Open' },
        after: { id: 'TRIAGED', label: 'Triaged' },
      },
      'changed the status from Open to Triaged',
    ],
    [
      'UPDATED',
      {
        field: 'section',
        before: { id: 'a', label: 'Backlog' },
        after: { id: 'b', label: 'In Review' },
      },
      'moved this task from Backlog to In Review',
    ],
    [
      'UPDATED',
      { field: 'section', before: null, after: { id: 'b', label: 'In Review' } },
      'moved this task from no section to In Review',
    ],
    [
      'UPDATED',
      { field: 'title', before: 'Old', after: 'New name' },
      'renamed this task to “New name”',
    ],
    ['UPDATED', { field: 'description', before: null, after: null }, 'edited the description'],
    [
      'UPDATED',
      {
        field: 'priority',
        before: { id: 'LOW', label: 'Low' },
        after: { id: 'HIGH', label: 'High' },
      },
      'changed the priority from Low to High',
    ],
    ['UPDATED', { field: 'dueDate', before: null, after: null }, 'removed the due date'],
    [
      'FIELD_CHANGED',
      {
        fieldName: 'Severity',
        before: { value: 'x', label: 'Low' },
        after: { value: 'y', label: 'High' },
      },
      'changed Severity from Low to High',
    ],
    [
      'FIELD_CHANGED',
      { fieldName: 'Severity', before: null, after: { value: 'y', label: 'High' } },
      'set Severity to High',
    ],
    [
      'FIELD_CHANGED',
      { fieldName: 'Severity', before: { value: 'x', label: 'Low' }, after: null },
      'cleared Severity',
    ],
    [
      'ATTACHED',
      { attachmentId: 'a', filename: 'spec.pdf', mimeType: 'application/pdf' },
      'attached spec.pdf',
    ],
    [
      'DETACHED',
      { attachmentId: 'a', filename: 'spec.pdf', mimeType: 'application/pdf' },
      'removed spec.pdf',
    ],
    ['FOLLOWED', { users: [ada], self: false }, 'added Ada Lovelace as a collaborator'],
    [
      'FOLLOWED',
      { users: [ada, grace], self: false },
      'added Ada Lovelace and Grace Hopper as collaborators',
    ],
    ['FOLLOWED', { users: [{ id: 'me', label: 'Me' }], self: true }, 'joined this task'],
    ['UNFOLLOWED', { users: [ada], self: false }, 'removed Ada Lovelace from the collaborators'],
    ['UNFOLLOWED', { users: [{ id: 'me', label: 'Me' }], self: true }, 'left this task'],
    ['SUBTASK_ADDED', { subtaskId: 's', title: 'Write tests' }, 'added subtask “Write tests”'],
    ['PINNED', { commentId: 'c' }, 'pinned a comment'],
    ['CREATED', null, 'created this task'],
  ] as const)('%s %j → %s', (action, metadata, expected) => {
    expect(describeStory(entry(action, metadata as Record<string, unknown> | null), ctx)).toBe(
      expected,
    );
  });

  it('formats a set due date with the day, and with the time when one was chosen', () => {
    const day = describeStory(
      entry('UPDATED', {
        field: 'dueDate',
        before: null,
        after: { date: '2026-09-12T00:00:00.000Z', at: null },
      }),
      ctx,
    );
    expect(day).toMatch(/^set the due date to .*12/);
    expect(day).not.toMatch(/at \d/);

    const moment = describeStory(
      entry('UPDATED', {
        field: 'dueDate',
        before: { date: '2026-09-01T00:00:00.000Z', at: null },
        after: { date: '2026-09-12T00:00:00.000Z', at: '2026-09-12T15:00:00.000Z' },
      }),
      ctx,
    );
    expect(moment).toMatch(/^changed the due date from .* to .* at \d/);
  });

  it('falls back to the summary for a shape it does not know', () => {
    expect(
      describeStory(entry('UPDATED', { fields: ['estimatedMinutes'] }, 'Updated task "X"'), ctx),
    ).toBe('updated task "X"');
    expect(describeStory(entry('MEMBER_ADDED', null, 'Added a member'), ctx)).toBe(
      'added a member',
    );
  });

  it('says ticket when the panel shows one', () => {
    expect(
      describeStory(
        entry('STATUS_CHANGED', { field: 'completed', before: 'incomplete', after: 'complete' }),
        {
          itemWord: 'ticket',
        },
      ),
    ).toBe('marked this ticket complete');
  });
});

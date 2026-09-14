import {
  diffItemStories,
  enumRef,
  humanizeEnum,
  snapshotFromTask,
  snapshotFromWorkItem,
  type ItemSnapshot,
} from '../../src/modules/activity-logs/item-stories';

const base: ItemSnapshot = {
  title: 'Ship the grid',
  description: null,
  status: { id: 'TODO', label: 'Todo' },
  completedAt: null,
  section: { id: 's1', label: 'Backlog' },
  priority: null,
  assignee: null,
  dueDate: null,
  dueAt: null,
  startDate: null,
  startAt: null,
};

const ada = { id: 'ada', label: 'Ada Lovelace' };
const grace = { id: 'grace', label: 'Grace Hopper' };

describe('diffItemStories', () => {
  it('says nothing when nothing moved', () => {
    expect(diffItemStories(base, { ...base }, 'task')).toEqual([]);
  });

  it('describes an assignment, a reassignment and an unassignment', () => {
    expect(diffItemStories(base, { ...base, assignee: ada }, 'task')).toEqual([
      {
        action: 'ASSIGNED',
        summary: 'Assigned to Ada Lovelace',
        metadata: { field: 'assignee', before: null, after: ada },
      },
    ]);

    expect(
      diffItemStories({ ...base, assignee: ada }, { ...base, assignee: grace }, 'task')[0],
    ).toMatchObject({ action: 'ASSIGNED', metadata: { before: ada, after: grace } });

    expect(diffItemStories({ ...base, assignee: ada }, base, 'task')).toEqual([
      {
        action: 'UNASSIGNED',
        summary: 'Unassigned Ada Lovelace',
        metadata: { field: 'assignee', before: ada, after: null },
      },
    ]);
  });

  it('reads a task going to DONE as completion, not as a status change', () => {
    const stories = diffItemStories(
      base,
      { ...base, status: { id: 'DONE', label: 'Done' }, completedAt: new Date() },
      'task',
    );

    expect(stories).toEqual([
      {
        action: 'STATUS_CHANGED',
        summary: 'Marked the task complete',
        metadata: { field: 'completed', before: 'incomplete', after: 'complete' },
      },
    ]);
  });

  it('reads a task reopened as incomplete', () => {
    const stories = diffItemStories(
      { ...base, status: { id: 'DONE', label: 'Done' }, completedAt: new Date() },
      base,
      'task',
    );

    expect(stories[0]).toMatchObject({
      metadata: { field: 'completed', before: 'complete', after: 'incomplete' },
    });
  });

  it('keeps a status story for a task moving between open states', () => {
    const stories = diffItemStories(
      base,
      { ...base, status: { id: 'IN_PROGRESS', label: 'In progress' } },
      'task',
    );

    expect(stories).toEqual([
      {
        action: 'STATUS_CHANGED',
        summary: 'Changed status from Todo to In progress',
        metadata: {
          field: 'status',
          before: { id: 'TODO', label: 'Todo' },
          after: { id: 'IN_PROGRESS', label: 'In progress' },
        },
      },
    ]);
  });

  it('prefers the status story for a ticket, even when it resolves', () => {
    const stories = diffItemStories(
      { ...base, status: { id: 'OPEN', label: 'Open' } },
      { ...base, status: { id: 'RESOLVED', label: 'Resolved' }, completedAt: new Date() },
      'ticket',
    );

    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({ metadata: { field: 'status' } });
  });

  it('describes a due date being set, moved, given a time, and removed', () => {
    const set = diffItemStories(base, { ...base, dueDate: '2026-09-12T00:00:00.000Z' }, 'task');
    expect(set).toEqual([
      {
        action: 'UPDATED',
        summary: 'Set the due date',
        metadata: {
          field: 'dueDate',
          before: null,
          after: { date: '2026-09-12T00:00:00.000Z', at: null },
        },
      },
    ]);

    const moved = diffItemStories(
      { ...base, dueDate: '2026-09-12T00:00:00.000Z' },
      { ...base, dueDate: '2026-09-14T00:00:00.000Z' },
      'task',
    );
    expect(moved[0]?.summary).toBe('Changed the due date');

    // A time-only change still moved the deadline.
    const timed = diffItemStories(
      { ...base, dueDate: '2026-09-12T00:00:00.000Z' },
      { ...base, dueDate: '2026-09-12T00:00:00.000Z', dueAt: '2026-09-12T15:00:00.000Z' },
      'task',
    );
    expect(timed[0]).toMatchObject({
      metadata: { after: { date: '2026-09-12T00:00:00.000Z', at: '2026-09-12T15:00:00.000Z' } },
    });

    const removed = diffItemStories({ ...base, dueDate: new Date('2026-09-12') }, base, 'task');
    expect(removed[0]?.summary).toBe('Removed the due date');
    expect(removed[0]?.metadata.after).toBeNull();
  });

  it('describes a section move, a rename, a description edit and a priority change', () => {
    const stories = diffItemStories(
      base,
      {
        ...base,
        title: 'Ship the grid, twice',
        description: '<p>Now with words</p>',
        section: { id: 's2', label: 'In Review' },
        priority: { id: 'HIGH', label: 'High' },
      },
      'task',
    );

    expect(stories.map((story) => story.metadata.field)).toEqual([
      'title',
      'description',
      'section',
      'priority',
    ]);
    expect(stories[2]?.summary).toBe('Moved from Backlog to In Review');
    expect(stories[3]?.summary).toBe('Changed priority from none to High');
  });
});

describe('snapshots', () => {
  it('humanises an enum and treats NONE as nothing', () => {
    expect(humanizeEnum('IN_PROGRESS')).toBe('In progress');
    expect(enumRef('NONE')).toBeNull();
    expect(enumRef('HIGH')).toEqual({ id: 'HIGH', label: 'High' });
  });

  it('reads a Prisma task row', () => {
    const snapshot = snapshotFromTask(
      {
        title: 'T',
        description: null,
        status: 'IN_PROGRESS',
        priority: 'NONE',
        completedAt: null,
        dueDate: new Date('2026-09-12T00:00:00.000Z'),
        dueAt: null,
        startDate: null,
        startAt: null,
      },
      { assignee: ada },
    );

    expect(snapshot.status).toEqual({ id: 'IN_PROGRESS', label: 'In progress' });
    expect(snapshot.priority).toBeNull();
    expect(snapshot.assignee).toEqual(ada);
  });

  it('reads a resolved work item, taking the first assignee', () => {
    const snapshot = snapshotFromWorkItem({
      title: 'T',
      description: null,
      status: { id: 'x', name: 'In Review' },
      priority: null,
      assignees: [
        { id: 'ada', name: 'Ada Lovelace' },
        { id: 'grace', name: 'Grace Hopper' },
      ],
      completedAt: null,
      dueDate: null,
      dueAt: null,
      startDate: null,
      startAt: null,
    });

    expect(snapshot.status).toEqual({ id: 'x', label: 'In Review' });
    expect(snapshot.assignee).toEqual(ada);
  });
});

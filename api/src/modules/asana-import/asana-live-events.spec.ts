import type { AsanaEvent } from '../../integrations/asana/asana.types';

import { addWork, emptyWork } from './asana-live-events';

const task = (gid: string, action = 'changed'): AsanaEvent => ({
  action,
  resource: { gid, resource_type: 'task' },
});

const story = (
  gid: string,
  subtype: string | undefined,
  parent: string | null,
  action = 'added',
): AsanaEvent => ({
  action,
  resource: { gid, resource_type: 'story', resource_subtype: subtype },
  parent: parent ? { gid: parent, resource_type: 'task' } : null,
});

describe('addWork', () => {
  it('reads each task an event names once, however many times it changed', () => {
    const work = emptyWork();
    addWork(work, 'P1', [task('T1'), task('T1'), task('T2', 'added'), task('T3', 'deleted')]);

    expect([...work.tasks]).toEqual(['T1', 'T2', 'T3']);
    expect(work.history.size).toBe(0);
  });

  it('reads the history of a task that got a comment or a file', () => {
    const work = emptyWork();
    addWork(work, 'P1', [
      story('S1', 'comment_added', 'T1'),
      {
        action: 'added',
        resource: { gid: 'A1', resource_type: 'attachment' },
        parent: { gid: 'T2', resource_type: 'task' },
      },
    ]);

    expect([...work.tasks]).toEqual(['T1', 'T2']);
    expect([...work.history]).toEqual(['T1', 'T2']);
  });

  it('skips the stories Asana writes about a change, which come with an event on the task', () => {
    const work = emptyWork();
    addWork(work, 'P1', [story('S1', 'due_date_changed', 'T1'), story('S2', 'assigned', 'T1')]);

    expect(work.tasks.size).toBe(0);
  });

  it('looks up the task of an edited comment, whose event does not name it', () => {
    const work = emptyWork();
    addWork(work, 'P1', [story('S1', 'comment_added', null, 'changed')]);

    expect([...work.stories]).toEqual(['S1']);
    expect(work.tasks.size).toBe(0);
  });

  it('reads the history of a task that lost a comment, which finds the deletion', () => {
    const work = emptyWork();
    addWork(work, 'P1', [story('S1', 'comment_added', 'T1', 'removed')]);

    expect([...work.tasks]).toEqual(['T1']);
    expect([...work.history]).toEqual(['T1']);
  });

  it('keeps a deleted comment whose event names no task, to be found by its ref', () => {
    const work = emptyWork();
    addWork(work, 'P1', [story('S1', 'comment_added', null, 'deleted')]);

    expect([...work.deletedStories]).toEqual(['S1']);
    expect(work.stories.size).toBe(0);
    expect(work.tasks.size).toBe(0);
  });

  it('reads a project again when its details, fields or members changed', () => {
    const work = emptyWork();
    addWork(work, 'P1', [
      { action: 'changed', resource: { gid: 'P1', resource_type: 'project' } },
      {
        action: 'added',
        resource: { gid: 'CFS1', resource_type: 'custom_field_setting' },
        parent: { gid: 'P1', resource_type: 'project' },
      },
      { action: 'added', resource: { gid: 'M1', resource_type: 'membership' } },
    ]);
    addWork(work, 'P2', [{ action: 'deleted', resource: { gid: 'P2', resource_type: 'project' } }]);

    expect([...work.projects.keys()]).toEqual(['P1']);
    expect([...(work.projects.get('P1') ?? [])]).toEqual(['details', 'fields', 'members']);
  });

  it('re-reads a project’s sections when one changed', () => {
    const work = emptyWork();
    addWork(work, 'P1', [
      {
        action: 'added',
        resource: { gid: 'SEC9', resource_type: 'section' },
        parent: { gid: 'P1', resource_type: 'project' },
      },
    ]);

    expect([...work.sections]).toEqual(['P1']);
  });
});

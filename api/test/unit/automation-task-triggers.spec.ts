import { AUTOMATION_TRIGGERS, AutomationTrigger } from '@coretask/contracts';

import { triggerCatalogue } from '../../src/modules/automations/builder/automation-catalogue';
import {
  FIELD_CHANGE_TRIGGER,
  changedTaskFields,
  fieldChangeTriggers,
  taskFieldSnapshot,
  type WatchedTaskFields,
} from '../../src/modules/automations/task-field-triggers';

/**
 * The per-field task triggers: what raises them, and that the picker offers
 * them as working rows rather than the greyed placeholders they replaced.
 */
describe('the per-field task triggers', () => {
  const task: WatchedTaskFields = {
    title: 'Renew the lease',
    description: 'Call first.',
    dueDate: new Date('2026-03-01T00:00:00.000Z'),
    dueAt: null,
    startDate: null,
    startAt: null,
    estimatedMinutes: 30,
  };

  it('names only real triggers', () => {
    for (const trigger of Object.values(FIELD_CHANGE_TRIGGER)) {
      expect(AUTOMATION_TRIGGERS).toContain(trigger);
    }
  });

  it('reads which watched columns moved, and only those', () => {
    expect(changedTaskFields(task, { ...task })).toEqual([]);
    expect(changedTaskFields(task, { ...task, title: 'Renew the lease early' })).toEqual(['title']);
    expect(changedTaskFields(task, { ...task, description: null })).toEqual(['description']);
    expect(changedTaskFields(task, { ...task, estimatedMinutes: 45 })).toEqual([
      'estimatedMinutes',
    ]);
  });

  it('reads a moved time as a moved date, and a re-saved date as no change', () => {
    // The same instant in a different Date object is the same day.
    const same = { ...task, dueDate: new Date('2026-03-01T00:00:00.000Z') };
    expect(changedTaskFields(task, same)).toEqual([]);

    expect(changedTaskFields(task, { ...task, dueAt: new Date('2026-03-01T09:00:00Z') })).toEqual([
      'dueDate',
    ]);
    expect(
      changedTaskFields(task, { ...task, startDate: new Date('2026-02-20T00:00:00Z') }),
    ).toEqual(['startDate']);
  });

  it('turns changed columns into triggers, each once, in either spelling', () => {
    expect(fieldChangeTriggers(['dueDate', 'dueAt'])).toEqual([
      AutomationTrigger.TASK_DUE_DATE_CHANGED,
    ]);
    expect(fieldChangeTriggers(['title', 'status', 'estimatedMinutes', 'startAt'])).toEqual([
      AutomationTrigger.TASK_TITLE_CHANGED,
      AutomationTrigger.TASK_ESTIMATE_CHANGED,
      AutomationTrigger.TASK_START_DATE_CHANGED,
    ]);
    expect(fieldChangeTriggers(['description'])).toEqual([
      AutomationTrigger.TASK_DESCRIPTION_CHANGED,
    ]);
    expect(fieldChangeTriggers([])).toEqual([]);
  });

  it('carries the watched fields on an event as ISO dates, without the description', () => {
    expect(taskFieldSnapshot(task)).toEqual({
      title: 'Renew the lease',
      dueDate: '2026-03-01T00:00:00.000Z',
      startDate: null,
      estimatedMinutes: 30,
    });
  });

  /*
   * These rows were greyed placeholders — "nothing narrower fires for this
   * field alone" — and are now the real triggers, filed where the picker read
   * the placeholders: the dates under their own groups, the rest under "Task
   * field is changed".
   */
  it('offers each as an available trigger row in its group', () => {
    const rows = triggerCatalogue([]);
    const row = (subtype: AutomationTrigger) => rows.find((entry) => entry.subtype === subtype);

    expect(row(AutomationTrigger.TASK_DUE_DATE_CHANGED)).toMatchObject({
      label: 'Due date is changed',
      category: 'Due date is…',
      available: true,
      reason: null,
    });
    expect(row(AutomationTrigger.TASK_START_DATE_CHANGED)).toMatchObject({
      label: 'Start date is changed',
      category: 'Start date is…',
      available: true,
    });
    expect(row(AutomationTrigger.TASK_ESTIMATE_CHANGED)).toMatchObject({
      label: 'Estimate is changed',
      category: 'Task field is changed',
      available: true,
    });
    expect(row(AutomationTrigger.TASK_TITLE_CHANGED)).toMatchObject({
      label: 'Task name is changed',
      available: true,
    });
    expect(row(AutomationTrigger.TASK_DESCRIPTION_CHANGED)).toMatchObject({
      label: 'Task description is changed',
      available: true,
    });

    // And the placeholders they replaced are gone rather than doubled.
    const labels = rows.map((entry) => entry.label);
    expect(labels.filter((label) => label === 'Due date is changed')).toHaveLength(1);
    expect(labels.filter((label) => label === 'Task name is changed')).toHaveLength(1);
  });
});

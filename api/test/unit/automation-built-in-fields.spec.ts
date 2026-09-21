import { AutomationAction, CONDITION_VALUE_TYPE } from '@coretask/contracts';
import type { Task } from '@prisma/client';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';
import {
  ACTION_CATEGORY,
  CONDITION_CATEGORY,
  actionCatalogue,
  conditionCatalogue,
} from '../../src/modules/automations/builder/automation-catalogue';

/**
 * The built-in columns the list view shows, reachable from a rule: the
 * estimate and the two dates the task keeps for itself as conditions, and the
 * start date and estimate as actions beside the due date the engine already
 * set.
 */
describe('the built-in fields a rule can ask about and set', () => {
  const conditions = conditionCatalogue([]);
  const actions = actionCatalogue([]);

  it.each([
    ['estimatedMinutes', 'Estimate is…', CONDITION_VALUE_TYPE.NUMBER],
    ['createdAt', 'Created is…', CONDITION_VALUE_TYPE.DATE],
    ['completedAt', 'Completed on is…', CONDITION_VALUE_TYPE.DATE],
  ])('offers %s as a working task-field condition', (subtype, label, valueType) => {
    expect(conditions.find((entry) => entry.subtype === subtype)).toMatchObject({
      label,
      valueType,
      category: CONDITION_CATEGORY.TASK_FIELD,
      available: true,
      reason: null,
    });
  });

  it.each([
    [AutomationAction.SET_START_DATE, 'Change start date to…'],
    [AutomationAction.CLEAR_START_DATE, 'Clear the start date'],
    [AutomationAction.SET_ESTIMATE, 'Change estimate to…'],
  ])('offers %s under "Change task field to…"', (subtype, label) => {
    expect(actions.find((entry) => entry.subtype === subtype)).toMatchObject({
      label,
      category: ACTION_CATEGORY.CHANGE_FIELD,
      available: true,
      reason: null,
    });
  });

  it('reads the new fields off the task itself, dates as ISO strings', () => {
    const runner = new AutomationRunnerService({} as never, {} as never);
    const readField = (field: string, task: Task): unknown =>
      (
        runner as unknown as {
          readField(field: string, task: Task, event: AutomationEvent): unknown;
        }
      ).readField(field, task, { after: {} } as unknown as AutomationEvent);

    const task = {
      estimatedMinutes: 45,
      createdAt: new Date('2026-01-05T10:00:00.000Z'),
      completedAt: null,
    } as unknown as Task;

    expect(readField('estimatedMinutes', task)).toBe(45);
    expect(readField('createdAt', task)).toBe('2026-01-05T10:00:00.000Z');
    // Empty while the task is open, so "completed on is empty" can hold.
    expect(readField('completedAt', task)).toBeNull();
    expect(
      readField('completedAt', {
        ...task,
        completedAt: new Date('2026-02-01T00:00:00.000Z'),
      } as unknown as Task),
    ).toBe('2026-02-01T00:00:00.000Z');
  });
});

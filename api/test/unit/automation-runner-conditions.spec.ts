import {
  CONDITION_OPERATOR,
  DIRECT_CONDITION_OPERATORS,
  isEvaluableOperator,
  type ConditionOperator,
} from '@coretask/contracts';
import type { Task } from '@prisma/client';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';
import { customFieldKey } from '../../src/modules/automations/builder/automation-catalogue';
import { directComparison } from '../../src/modules/automations/condition-comparison';

/**
 * The comparisons a condition can make, run through the runner's own switch.
 *
 * Each of these is an operator the builder offers on some field type. A case
 * missing from the switch does not throw — it falls to `default`, returns
 * false, and the rule publishes, goes ACTIVE and never fires. So the assertion
 * is never that a case exists; it is that the comparison holds for a value it
 * should and fails for one it should not.
 */
describe('the comparisons a condition can make', () => {
  const runner = new AutomationRunnerService({} as never, {} as never);

  const event = {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    trigger: 'TASK_UPDATED',
    entityType: 'TASK',
    entityId: 'task-1',
    after: {},
    correlationId: 'correlation-1',
    depth: 0,
  } as unknown as AutomationEvent;

  const holds = (
    configuration: Record<string, unknown>,
    task: Task,
    on: AutomationEvent = event,
  ): boolean =>
    (
      runner as unknown as {
        conditionHolds(
          node: { subtype: string; configuration: Record<string, unknown> },
          task: Task,
          event: AutomationEvent,
        ): boolean;
      }
    ).conditionHolds({ subtype: 'FIELD_COMPARISON', configuration }, task, on);

  const blank: Record<string, unknown> = {
    textValue: null,
    numberValue: null,
    dateValue: null,
    booleanValue: null,
    optionIds: [],
    userIds: [],
  };

  const base = {
    id: 'task-1',
    completedAt: null,
    dueDate: new Date('2026-02-03T00:00:00.000Z'),
    customFieldValues: [],
  } as unknown as Task;

  const holding = (row: Record<string, unknown>): Task =>
    ({ ...base, customFieldValues: [{ ...blank, ...row }] }) as unknown as Task;

  describe('a checkbox', () => {
    const field = customFieldKey('field-renewed');

    it('holds "is checked" when ticked and "is not checked" when not', () => {
      const ticked = holding({ customFieldId: 'field-renewed', booleanValue: true });
      const cleared = holding({ customFieldId: 'field-renewed', booleanValue: false });

      expect(holds({ field, operator: 'IS_CHECKED' }, ticked)).toBe(true);
      expect(holds({ field, operator: 'IS_NOT_CHECKED' }, ticked)).toBe(false);
      expect(holds({ field, operator: 'IS_CHECKED' }, cleared)).toBe(false);
      expect(holds({ field, operator: 'IS_NOT_CHECKED' }, cleared)).toBe(true);
    });

    it('reads a box nobody has touched as not checked', () => {
      expect(holds({ field, operator: 'IS_CHECKED' }, base)).toBe(false);
      expect(holds({ field, operator: 'IS_NOT_CHECKED' }, base)).toBe(true);
    });
  });

  describe('the completion check', () => {
    it('is "is checked" on a completed task, or on the roll-up event for one', () => {
      const done = { ...base, completedAt: new Date('2026-01-02T03:04:05Z') } as unknown as Task;
      const rolledUp = { ...event, after: { allSubtasksCompleted: true } } as AutomationEvent;

      expect(holds({ field: 'completed', operator: 'IS_CHECKED' }, done)).toBe(true);
      expect(holds({ field: 'completed', operator: 'IS_CHECKED' }, base)).toBe(false);
      expect(holds({ field: 'completed', operator: 'IS_CHECKED' }, base, rolledUp)).toBe(true);
      expect(holds({ field: 'completed', operator: 'IS_NOT_CHECKED' }, base)).toBe(true);
    });
  });

  describe('a date', () => {
    const due = (operator: string, value: string) => ({ field: 'dueDate', operator, value });

    it('keeps "before" and "after" the right way round', () => {
      // The builder stores IS_BEFORE. This used to be decided by testing the
      // stored name against BEFORE, so every "before" written in the panel ran
      // as "after".
      expect(holds(due('IS_BEFORE', '2026-03-01'), base)).toBe(true);
      expect(holds(due('IS_AFTER', '2026-03-01'), base)).toBe(false);
      expect(holds(due('IS_AFTER', '2026-01-01'), base)).toBe(true);
      expect(holds(due('IS_BEFORE', '2026-01-01'), base)).toBe(false);
      // And the names already in the database keep meaning the same.
      expect(holds(due('BEFORE', '2026-03-01'), base)).toBe(true);
    });

    const now = new Date('2026-06-15T13:00:00.000Z');
    const on = (operator: ConditionOperator, day: string, value?: string) =>
      directComparison(operator, `${day}T00:00:00.000Z`, value, now);

    it('reads "is today" as the same calendar day, whatever the hour', () => {
      expect(on('IS_TODAY', '2026-06-15')).toBe(true);
      expect(directComparison('IS_TODAY', '2026-06-15T23:59:00.000Z', undefined, now)).toBe(true);
      expect(on('IS_TODAY', '2026-06-16')).toBe(false);
      expect(on('IS_TODAY', '2026-06-14')).toBe(false);
    });

    it('reads "is overdue" as a day already gone', () => {
      expect(on('IS_OVERDUE', '2026-06-14')).toBe(true);
      expect(on('IS_OVERDUE', '2026-06-15')).toBe(false);
      expect(on('IS_OVERDUE', '2026-06-16')).toBe(false);
    });

    it('reads "within the next N days" from today through the Nth day', () => {
      expect(on('IS_WITHIN_NEXT', '2026-06-18', '3')).toBe(true);
      expect(on('IS_WITHIN_NEXT', '2026-06-19', '3')).toBe(false);
      expect(on('IS_WITHIN_NEXT', '2026-06-15', '0')).toBe(true);
      // Yesterday is not ahead, however far ahead one looks.
      expect(on('IS_WITHIN_NEXT', '2026-06-14', '30')).toBe(false);
      expect(on('IS_WITHIN_NEXT', '2026-06-16', '-1')).toBe(false);
    });

    it('fails rather than throws on something that is not a date', () => {
      expect(directComparison('IS_TODAY', 'not a date', undefined, now)).toBe(false);
      expect(directComparison('IS_OVERDUE', null, undefined, now)).toBe(false);
      expect(directComparison('IS_WITHIN_NEXT', '2026-06-16', 'soon', now)).toBe(false);
    });

    it('runs the clock comparisons through the runner too', () => {
      const today = new Date();
      const dueToday = {
        ...base,
        dueDate: new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
        ),
      } as unknown as Task;

      expect(holds({ field: 'dueDate', operator: 'IS_TODAY' }, dueToday)).toBe(true);
      expect(holds({ field: 'dueDate', operator: 'IS_OVERDUE' }, dueToday)).toBe(false);
      expect(holds({ field: 'dueDate', operator: 'IS_WITHIN_NEXT', value: '7' }, dueToday)).toBe(
        true,
      );
    });
  });

  describe('a text field', () => {
    const field = customFieldKey('field-notes');
    const note = holding({ customFieldId: 'field-notes', textValue: 'Call the tenant' });

    it('matches "starts with" and "ends with" the way "contains" matches', () => {
      expect(holds({ field, operator: 'STARTS_WITH', value: 'call' }, note)).toBe(true);
      expect(holds({ field, operator: 'STARTS_WITH', value: 'tenant' }, note)).toBe(false);
      expect(holds({ field, operator: 'ENDS_WITH', value: 'TENANT' }, note)).toBe(true);
      expect(holds({ field, operator: 'ENDS_WITH', value: 'call' }, note)).toBe(false);
      expect(holds({ field, operator: 'CONTAINS', value: 'the' }, note)).toBe(true);
    });

    it('never matches an empty field, or an empty value', () => {
      expect(holds({ field, operator: 'STARTS_WITH', value: 'call' }, base)).toBe(false);
      expect(holds({ field, operator: 'ENDS_WITH', value: '' }, note)).toBe(false);
    });
  });

  describe('a number', () => {
    const field = customFieldKey('field-effort');
    const eight = holding({ customFieldId: 'field-effort', numberValue: 8 });

    it('compares the inclusive bounds', () => {
      expect(holds({ field, operator: 'GREATER_THAN_OR_EQUAL', value: '8' }, eight)).toBe(true);
      expect(holds({ field, operator: 'GREATER_THAN_OR_EQUAL', value: '9' }, eight)).toBe(false);
      expect(holds({ field, operator: 'LESS_THAN_OR_EQUAL', value: '8' }, eight)).toBe(true);
      expect(holds({ field, operator: 'LESS_THAN_OR_EQUAL', value: '7' }, eight)).toBe(false);
    });

    it('reads "between" inclusively and either way round', () => {
      expect(holds({ field, operator: 'BETWEEN', value: ['5', '10'] }, eight)).toBe(true);
      expect(holds({ field, operator: 'BETWEEN', value: ['10', '5'] }, eight)).toBe(true);
      expect(holds({ field, operator: 'BETWEEN', value: ['8', '8'] }, eight)).toBe(true);
      expect(holds({ field, operator: 'BETWEEN', value: ['9', '12'] }, eight)).toBe(false);
      expect(holds({ field, operator: 'BETWEEN', value: ['5', '10'] }, base)).toBe(false);
      expect(holds({ field, operator: 'BETWEEN', value: ['5'] }, eight)).toBe(false);
    });
  });

  /*
   * The list the catalogue trusts, held to the switch it trusts. An operator
   * added to `DIRECT_CONDITION_OPERATORS` without a case in `directComparison`
   * would be offered as working and fall to `default` on every event — so each
   * one must have an example it holds for, and the examples must cover the list.
   */
  it('has a holding example for every direct operator, and no more', () => {
    const now = new Date('2026-06-15T13:00:00.000Z');
    const examples: Record<string, [unknown, unknown]> = {
      [CONDITION_OPERATOR.IS_CHECKED]: [true, undefined],
      [CONDITION_OPERATOR.IS_NOT_CHECKED]: [null, undefined],
      [CONDITION_OPERATOR.STARTS_WITH]: ['Call the tenant', 'call'],
      [CONDITION_OPERATOR.ENDS_WITH]: ['Call the tenant', 'TENANT'],
      [CONDITION_OPERATOR.BETWEEN]: [8, ['5', '10']],
      [CONDITION_OPERATOR.IS_TODAY]: ['2026-06-15T00:00:00.000Z', undefined],
      [CONDITION_OPERATOR.IS_OVERDUE]: ['2026-06-01T00:00:00.000Z', undefined],
      [CONDITION_OPERATOR.IS_WITHIN_NEXT]: ['2026-06-17T00:00:00.000Z', '2'],
    };

    expect(Object.keys(examples).sort()).toEqual([...DIRECT_CONDITION_OPERATORS].sort());

    for (const operator of DIRECT_CONDITION_OPERATORS) {
      const [actual, expected] = examples[operator]!;

      expect({ operator, evaluable: isEvaluableOperator(operator) }).toEqual({
        operator,
        evaluable: true,
      });
      expect({ operator, holds: directComparison(operator, actual, expected, now) }).toEqual({
        operator,
        holds: true,
      });
    }
  });
});

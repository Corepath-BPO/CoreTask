import { AutomationBranchType, ConditionGroupOperator, GraphIssueLevel } from '@coretask/contracts';
import type { AutomationBranchDefinition } from '@coretask/types';

import {
  checkShapes,
  checkWritable,
  collectReferences,
  type CheckableDefinition,
} from './automation-definition.references';

/**
 * The invariants, asserted where they are decided.
 *
 * Every one of these is a refusal, and a refusal is only worth having if it is
 * the *right* refusal — a draft that will not save because a section has not
 * been chosen yet is as broken as one that saves with a section from somebody
 * else's project. The split between the two is what these pin down.
 */

const UUID = {
  section: '019fc8d5-0000-7000-8000-000000000101',
  member: '019fc8d5-0000-7000-8000-000000000102',
  field: '019fc8d5-0000-7000-8000-000000000103',
  status: '019fc8d5-0000-7000-8000-000000000104',
};

let sequence = 0;
const id = () => `local-${(sequence += 1)}`;

function action(actionType: string, configuration: Record<string, unknown> = {}, position = 0) {
  return { id: id(), actionType, configuration, position };
}

function condition(fieldKey: string, operator: string, value: unknown = null, position = 0) {
  return { id: id(), fieldKey, operator, value, position };
}

function branch(partial: Partial<AutomationBranchDefinition> = {}): AutomationBranchDefinition {
  return {
    id: id(),
    type: AutomationBranchType.PRIMARY,
    position: 0,
    conditionGroup: null,
    actions: [],
    ...partial,
  };
}

const group = (...conditions: ReturnType<typeof condition>[]) => ({
  id: id(),
  operator: ConditionGroupOperator.ALL,
  conditions,
});

function definition(branches: AutomationBranchDefinition[]): CheckableDefinition {
  return { trigger: { type: 'TASK_CREATED', configuration: {} }, branches };
}

/** The messages of the issues that stop a draft being saved. */
const draftBlockers = (issues: { blocksDraft: boolean; message: string }[]) =>
  issues.filter((issue) => issue.blocksDraft).map((issue) => issue.message);

/* -------------------------------------------------------------------------- */

describe('the branch list a version can hold', () => {
  it('accepts one PRIMARY on its own', () => {
    expect(checkWritable([branch()])).toEqual([]);
  });

  it('refuses a second PRIMARY', () => {
    const issues = checkWritable([
      branch({ position: 0 }),
      branch({ type: AutomationBranchType.PRIMARY, position: 1 }),
    ]);

    expect(draftBlockers(issues)).toEqual([expect.stringContaining('exactly one')]);
  });

  it('refuses a rule with no PRIMARY at all', () => {
    const issues = checkWritable([branch({ type: AutomationBranchType.OTHERWISE_IF })]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('exactly one'));
  });

  it('refuses a PRIMARY anywhere but position zero', () => {
    const issues = checkWritable([
      branch({ type: AutomationBranchType.OTHERWISE_IF, position: 0 }),
      branch({ type: AutomationBranchType.PRIMARY, position: 1 }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('come first'));
  });

  it('refuses a second OTHERWISE', () => {
    const issues = checkWritable([
      branch({ position: 0 }),
      branch({ type: AutomationBranchType.OTHERWISE, position: 1 }),
      branch({ type: AutomationBranchType.OTHERWISE, position: 2 }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('only have one'));
  });

  /* Anything below a branch that catches everything is dead code the builder
   * had drawn as live. */
  it('refuses an OTHERWISE that is not last', () => {
    const issues = checkWritable([
      branch({ position: 0 }),
      branch({ type: AutomationBranchType.OTHERWISE, position: 1 }),
      branch({ type: AutomationBranchType.OTHERWISE_IF, position: 2 }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('come last'));
  });

  it('refuses an OTHERWISE with conditions of its own', () => {
    const issues = checkWritable([
      branch({ position: 0 }),
      branch({
        type: AutomationBranchType.OTHERWISE,
        position: 1,
        conditionGroup: group(condition('status', 'IS', 'DONE')),
      }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('cannot have its own'));
  });

  /*
   * A gap and a duplicate come from the same failure — a reorder that wrote some
   * rows and not others — and a duplicate cannot reach the database at all.
   */
  it.each([
    ['a gap', [0, 2]],
    ['a duplicate', [0, 0]],
  ])('refuses branch positions with %s', (_name, positions) => {
    const issues = checkWritable([
      branch({ position: positions[0]! }),
      branch({ type: AutomationBranchType.OTHERWISE_IF, position: positions[1]! }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('valid order'));
  });

  it('refuses actions whose positions are not contiguous', () => {
    const issues = checkWritable([
      branch({ actions: [action('CLEAR_DUE_DATE', {}, 0), action('UNASSIGN_USER', {}, 5)] }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(expect.stringContaining('actions in this branch'));
  });

  it('refuses conditions whose positions are not contiguous', () => {
    const issues = checkWritable([
      branch({
        conditionGroup: group(
          condition('status', 'IS', 'DONE', 0),
          condition('priority', 'IS', 'HIGH', 3),
        ),
      }),
    ]);

    expect(draftBlockers(issues)).toContainEqual(
      expect.stringContaining('conditions in this branch'),
    );
  });

  /* Order is asked of `position`, never of the array, so a client that
   * serialises its branches in some other order is not failed for a fault that
   * does not exist. */
  it('reads order from position rather than from the array', () => {
    expect(
      checkWritable([
        branch({ type: AutomationBranchType.OTHERWISE, position: 1 }),
        branch({ type: AutomationBranchType.PRIMARY, position: 0 }),
      ]),
    ).toEqual([]);
  });
});

describe('what a step may be', () => {
  it('refuses an action the engine has no code for, and refuses it on the draft', () => {
    const issues = checkShapes(definition([branch({ actions: [action('LAUNCH_ROCKET')] })]));

    expect(draftBlockers(issues)).toEqual([expect.stringContaining('LAUNCH_ROCKET')]);
  });

  /*
   * A rule stored before a trigger was renamed has to load, report itself as
   * unrunnable, and be fixable — and it can only be fixed by being saved.
   */
  it('reports an unknown trigger without blocking the draft', () => {
    const issues = checkShapes({
      trigger: { type: 'TASK_TELEPATHED', configuration: {} },
      branches: [branch()],
    });

    expect(issues).toEqual([
      expect.objectContaining({ level: GraphIssueLevel.ERROR, blocksDraft: false }),
    ]);
  });

  /* Halfway through choosing a section is a state the builder has to be able to
   * save from, or autosave fights the person using it. */
  it('lets an action that has not been set up yet save, and blocks publishing it', () => {
    const issues = checkShapes(definition([branch({ actions: [action('MOVE_TO_SECTION')] })]));

    expect(draftBlockers(issues)).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({ level: GraphIssueLevel.ERROR, blocksDraft: false }),
    ]);
  });

  it('accepts an action configured with what the runner reads', () => {
    expect(
      checkShapes(
        definition([branch({ actions: [action('MOVE_TO_SECTION', { sectionId: UUID.section })] })]),
      ),
    ).toEqual([]);
  });

  /* No form produces either, so storing one would only move the failure on to
   * whoever reads it next. */
  it.each([
    ['a body that is not text', 'ADD_COMMENT', { body: { text: 'hello' } }],
    ['a section that is not an id', 'MOVE_TO_SECTION', { sectionId: 'the-first-one' }],
    ['a day count that is not a number', 'SET_DUE_DATE', { daysFromNow: 'tomorrow' }],
  ])('refuses %s on the draft', (_name, actionType, configuration) => {
    const issues = checkShapes(
      definition([branch({ actions: [action(actionType, configuration)] })]),
    );

    expect(draftBlockers(issues)).toHaveLength(1);
  });

  /*
   * The inspector writes the status definition's id and rules written before
   * those tables held the enum value. Both have to be readable or working rules
   * would be refused.
   */
  it.each([
    ['the status definition’s id', { statusDefinitionId: UUID.status }],
    ['the legacy enum value', { status: 'DONE' }],
  ])('accepts a status named by %s', (_name, configuration) => {
    expect(
      checkShapes(definition([branch({ actions: [action('UPDATE_STATUS', configuration)] })])),
    ).toEqual([]);
  });
});

describe('what a condition may compare', () => {
  it('accepts a comparison the builder offers', () => {
    expect(
      checkShapes(
        definition([branch({ conditionGroup: group(condition('status', 'IS', 'DONE')) })]),
      ),
    ).toEqual([]);
  });

  /* A converted legacy rule can carry a comparison the new vocabulary has no
   * word for, and it has to be openable to be corrected. */
  it('reports an operator it does not understand without blocking the draft', () => {
    const issues = checkShapes(
      definition([branch({ conditionGroup: group(condition('status', 'SOUNDS_LIKE', 'x')) })]),
    );

    expect(draftBlockers(issues)).toEqual([]);
    expect(issues).toHaveLength(1);
  });

  it('reports a condition with nothing chosen to compare against', () => {
    const issues = checkShapes(
      definition([branch({ conditionGroup: group(condition('status', 'IS', null)) })]),
    );

    expect(draftBlockers(issues)).toEqual([]);
    expect(issues).toHaveLength(1);
  });

  /* "Is empty" with a value beside it is a rule whose author believes the value
   * is being used, and the runner will ignore it without telling anybody. */
  it('refuses a value beside a comparison that takes none', () => {
    const issues = checkShapes(
      definition([branch({ conditionGroup: group(condition('title', 'IS_EMPTY', 'something')) })]),
    );

    expect(draftBlockers(issues)).toEqual([expect.stringContaining('takes no value')]);
  });

  it('refuses a single value where a comparison takes a list', () => {
    const issues = checkShapes(
      definition([branch({ conditionGroup: group(condition('status', 'IS_ONE_OF', 'DONE')) })]),
    );

    expect(draftBlockers(issues)).toEqual([expect.stringContaining('list of values')]);
  });
});

describe('what a rule points at', () => {
  it('finds the section a trigger is scoped to', () => {
    const found = collectReferences({
      trigger: { type: 'TASK_MOVED_TO_SECTION', configuration: { sectionId: UUID.section } },
      branches: [],
    });

    expect(found).toEqual([expect.objectContaining({ kind: 'SECTION', id: UUID.section })]);
  });

  it('finds every section of a trigger scoped to several', () => {
    const found = collectReferences({
      trigger: {
        type: 'TASK_MOVED_TO_SECTION',
        configuration: { sectionIds: [UUID.section, UUID.member] },
      },
      branches: [],
    });

    expect(found).toHaveLength(2);
  });

  it('finds the person an action assigns', () => {
    const found = collectReferences(
      definition([branch({ actions: [action('ASSIGN_USER', { userId: UUID.member })] })]),
    );

    expect(found).toEqual([expect.objectContaining({ kind: 'MEMBER', id: UUID.member })]);
  });

  /* The field is checked; its value is not. What a valid value looks like
   * depends on the field's type, and a deleted field never matches whatever it
   * was compared against. */
  it('finds the custom field a condition names, and not its value', () => {
    const found = collectReferences(
      definition([
        branch({
          conditionGroup: group(condition(`customField:${UUID.field}`, 'IS', UUID.status)),
        }),
      ]),
    );

    expect(found).toEqual([expect.objectContaining({ kind: 'CUSTOM_FIELD', id: UUID.field })]);
  });

  it('finds each of the sections a “is one of” condition lists', () => {
    const found = collectReferences(
      definition([
        branch({
          conditionGroup: group(condition('sectionId', 'IS_ONE_OF', [UUID.section, UUID.member])),
        }),
      ]),
    );

    expect(found.map((it) => it.id)).toEqual([UUID.section, UUID.member]);
  });

  /*
   * The id columns are `@db.Uuid` and Postgres rejects a malformed uuid in an
   * `IN` list outright, so a status held as the legacy enum value would turn a
   * validation message into a 500.
   */
  it('leaves a value that is not an id out of the lookup', () => {
    const found = collectReferences(
      definition([branch({ actions: [action('UPDATE_STATUS', { status: 'DONE' })] })]),
    );

    expect(found).toEqual([]);
  });
});

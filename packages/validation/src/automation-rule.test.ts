import { AutomationBranchType } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import { saveRuleDefinitionSchema, validateRuleDefinition } from './automation-rule.js';

type Definition = Parameters<typeof validateRuleDefinition>[0];
type Branch = Definition['branches'][number];

const branch = (over: Partial<Branch> = {}): Branch => ({
  id: 'branch-1',
  type: AutomationBranchType.PRIMARY,
  position: 0,
  conditionGroup: { conditions: [{ position: 0 }] },
  actions: [{ position: 0 }],
  ...over,
});

const rule = (over: Partial<Definition> = {}): Definition => ({
  name: 'Assign on review',
  trigger: { type: 'TASK_MOVED_TO_SECTION' },
  branches: [branch()],
  ...over,
});

const messages = (over: Partial<Definition> = {}) =>
  validateRuleDefinition(rule(over)).map((issue) => issue.message);

const errors = (over: Partial<Definition> = {}) =>
  validateRuleDefinition(rule(over)).filter((issue) => issue.level === 'ERROR');

describe('rule shape', () => {
  it('accepts the smallest useful rule', () => {
    expect(errors()).toEqual([]);
  });

  it('accepts a rule with every kind of branch', () => {
    expect(
      errors({
        branches: [
          branch({ id: 'a', type: AutomationBranchType.PRIMARY, position: 0 }),
          branch({ id: 'b', type: AutomationBranchType.OTHERWISE_IF, position: 1 }),
          branch({
            id: 'c',
            type: AutomationBranchType.OTHERWISE,
            position: 2,
            conditionGroup: null,
          }),
        ],
      }),
    ).toEqual([]);
  });

  it('wants a name', () => {
    expect(messages({ name: '' })).toContain('Give the rule a name.');
    expect(messages({ name: '   ' })).toContain('Give the rule a name.');
  });

  it('wants a trigger', () => {
    expect(messages({ trigger: null })).toContain('Choose what starts this rule.');
    expect(messages({ trigger: { type: '  ' } })).toContain('Choose what starts this rule.');
  });

  it('wants at least one branch', () => {
    expect(messages({ branches: [] })).toContain('Add at least one branch.');
  });
});

describe('branch types and their order', () => {
  it('wants a primary branch', () => {
    expect(messages({ branches: [branch({ type: AutomationBranchType.OTHERWISE_IF })] })).toContain(
      'A rule has to start with a “Check if” branch.',
    );
  });

  it('refuses a second primary branch', () => {
    expect(
      messages({
        branches: [branch({ id: 'a' }), branch({ id: 'b', position: 1 })],
      }),
    ).toContain('A rule can only have one “Check if” branch.');
  });

  it('wants the primary branch first', () => {
    // Order is asked of `position`, not of how the client serialised the array.
    expect(
      messages({
        branches: [
          branch({ id: 'a', type: AutomationBranchType.PRIMARY, position: 1 }),
          branch({ id: 'b', type: AutomationBranchType.OTHERWISE_IF, position: 0 }),
        ],
      }),
    ).toContain('The “Check if” branch has to come first.');
  });

  it('refuses a second otherwise', () => {
    const issues = messages({
      branches: [
        branch({ id: 'a', position: 0 }),
        branch({
          id: 'b',
          type: AutomationBranchType.OTHERWISE,
          position: 1,
          conditionGroup: null,
        }),
        branch({
          id: 'c',
          type: AutomationBranchType.OTHERWISE,
          position: 2,
          conditionGroup: null,
        }),
      ],
    });

    expect(issues).toContain('A rule can only have one “Otherwise” branch.');
  });

  it('refuses an otherwise that is not last', () => {
    /*
     * Anything below a branch that catches everything is dead code the builder
     * has drawn as live.
     */
    const issues = messages({
      branches: [
        branch({ id: 'a', position: 0 }),
        branch({
          id: 'b',
          type: AutomationBranchType.OTHERWISE,
          position: 1,
          conditionGroup: null,
        }),
        branch({ id: 'c', type: AutomationBranchType.OTHERWISE_IF, position: 2 }),
      ],
    });

    expect(issues).toContain('The “Otherwise” branch has to come last.');
  });

  it('refuses an otherwise carrying its own conditions', () => {
    // The runner reaches it by exhausting the list, so it would never test them.
    const issues = messages({
      branches: [
        branch({ id: 'a', position: 0 }),
        branch({
          id: 'b',
          type: AutomationBranchType.OTHERWISE,
          position: 1,
          conditionGroup: { conditions: [{ position: 0 }] },
        }),
      ],
    });

    expect(issues).toContain(
      '“Otherwise” runs when nothing else matched, so it cannot have its own conditions.',
    );
  });
});

describe('what a branch has to contain', () => {
  it('wants a condition group on a primary branch', () => {
    expect(messages({ branches: [branch({ conditionGroup: null })] })).toContain(
      'Choose what this branch checks for.',
    );
  });

  it('wants a condition group on an otherwise-if branch', () => {
    expect(
      messages({
        branches: [
          branch({ id: 'a', position: 0 }),
          branch({
            id: 'b',
            type: AutomationBranchType.OTHERWISE_IF,
            position: 1,
            conditionGroup: null,
          }),
        ],
      }),
    ).toContain('Choose what this branch checks for.');
  });

  it('refuses an empty condition group', () => {
    expect(messages({ branches: [branch({ conditionGroup: { conditions: [] } })] })).toContain(
      'Add at least one condition to this branch.',
    );
  });

  it('refuses a branch with no actions', () => {
    /*
     * A branch that matches and then does nothing is indistinguishable at
     * runtime from one that never matched, so it can only be an unfinished edit.
     */
    const issues = validateRuleDefinition(rule({ branches: [branch({ actions: [] })] }));

    expect(issues.map((issue) => issue.message)).toContain(
      'Add at least one action to this branch.',
    );
    expect(issues[0]?.nodeId).toBe('branch-1');
  });
});

describe('positions', () => {
  it('refuses a gap between branch positions', () => {
    expect(
      messages({
        branches: [
          branch({ id: 'a', position: 0 }),
          branch({ id: 'b', type: AutomationBranchType.OTHERWISE_IF, position: 2 }),
        ],
      }),
    ).toContain('These branches are not in a valid order.');
  });

  it('refuses two branches sharing a position', () => {
    // The database's unique index would refuse this too, but only after the
    // person had already done the work.
    expect(
      messages({
        branches: [
          branch({ id: 'a', position: 0 }),
          branch({ id: 'b', type: AutomationBranchType.OTHERWISE_IF, position: 0 }),
        ],
      }),
    ).toContain('These branches are not in a valid order.');
  });

  it('refuses a gap between condition positions', () => {
    expect(
      messages({
        branches: [branch({ conditionGroup: { conditions: [{ position: 0 }, { position: 2 }] } })],
      }),
    ).toContain('The conditions in this branch are not in a valid order.');
  });

  it('refuses two conditions sharing a position', () => {
    expect(
      messages({
        branches: [branch({ conditionGroup: { conditions: [{ position: 1 }, { position: 1 }] } })],
      }),
    ).toContain('The conditions in this branch are not in a valid order.');
  });

  it('refuses a gap between action positions', () => {
    expect(
      messages({ branches: [branch({ actions: [{ position: 0 }, { position: 2 }] })] }),
    ).toContain('The actions in this branch are not in a valid order.');
  });

  it('refuses actions that do not start at zero', () => {
    expect(
      messages({ branches: [branch({ actions: [{ position: 1 }, { position: 2 }] })] }),
    ).toContain('The actions in this branch are not in a valid order.');
  });
});

describe('the save payload', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    name: 'Assign on review',
    trigger: { type: 'TASK_MOVED_TO_SECTION', configuration: { form: 'SECTION_CHANGED' } },
    branches: [
      {
        id: 'branch-1',
        type: 'PRIMARY',
        position: 0,
        conditionGroup: {
          id: 'group-1',
          conditions: [
            { id: 'c-1', fieldKey: 'status', operator: 'IS', value: 'done', position: 0 },
          ],
        },
        actions: [{ id: 'a-1', actionType: 'ASSIGN_USER', position: 0 }],
      },
    ],
    ...over,
  });

  it('accepts a complete payload and defaults the group operator to ALL', () => {
    const parsed = saveRuleDefinitionSchema.parse(payload());

    expect(parsed.branches[0]?.conditionGroup?.operator).toBe('ALL');
    expect(parsed.branches[0]?.actions[0]?.configuration).toEqual({});
  });

  it('leaves a condition value alone whatever shape it is', () => {
    // Per-field validation needs the project's metadata, so it happens in the
    // API. Narrowing the shape here would refuse values that are perfectly fine.
    const withList = payload({
      branches: [
        {
          ...payload().branches[0],
          conditionGroup: {
            id: 'group-1',
            conditions: [
              {
                id: 'c-1',
                fieldKey: 'assigneeId',
                operator: 'IS_ONE_OF',
                value: ['a', 'b'],
                position: 0,
              },
            ],
          },
        },
      ],
    });

    expect(
      saveRuleDefinitionSchema.parse(withList).branches[0]?.conditionGroup?.conditions[0]?.value,
    ).toEqual(['a', 'b']);
  });

  it('refuses a negative or fractional position', () => {
    const at = (position: number) =>
      payload({ branches: [{ ...payload().branches[0], position }] });

    expect(saveRuleDefinitionSchema.safeParse(at(-1)).success).toBe(false);
    expect(saveRuleDefinitionSchema.safeParse(at(1.5)).success).toBe(false);
  });

  it('refuses a branch type the database has no column for', () => {
    expect(
      saveRuleDefinitionSchema.safeParse(
        payload({ branches: [{ ...payload().branches[0], type: 'ELSE' }] }),
      ).success,
    ).toBe(false);
  });

  it('wants a name and a trigger', () => {
    expect(saveRuleDefinitionSchema.safeParse(payload({ name: '  ' })).success).toBe(false);
    expect(saveRuleDefinitionSchema.safeParse(payload({ trigger: { type: '' } })).success).toBe(
      false,
    );
  });
});

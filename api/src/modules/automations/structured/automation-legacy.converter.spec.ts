import { AutomationBranchType, BranchKey, ConditionGroupOperator } from '@coretask/contracts';

import { convertLegacyRule, type LegacyNode } from './automation-legacy.converter';

/**
 * The conversion is tested here rather than through the endpoint because these
 * are shapes nobody can build any more. A node tree with a branch nested in
 * another branch's else arm is what "otherwise if" used to be, and the only way
 * to keep proving it still reads correctly is to write one down.
 */

/** Predictable ids, so an assertion can name the branch it means. */
function ids(): () => string {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

const RULE = { triggerType: 'TASK_CREATED', triggerConfig: { sectionId: 'from-the-rule' } };

function node(partial: Partial<LegacyNode> & Pick<LegacyNode, 'id' | 'nodeType'>): LegacyNode {
  return {
    subtype: '',
    configuration: null,
    parentNodeId: null,
    branchKey: null,
    position: 0,
    ...partial,
  };
}

const convert = (nodes: LegacyNode[], rule = RULE) => convertLegacyRule(nodes, rule, ids());

describe('the trigger', () => {
  it('comes from the TRIGGER node', () => {
    const { trigger } = convert([
      node({
        id: 't',
        nodeType: 'TRIGGER',
        subtype: 'TASK_MOVED_TO_SECTION',
        configuration: { sectionId: 'from-the-node' },
      }),
    ]);

    expect(trigger).toEqual({
      type: 'TASK_MOVED_TO_SECTION',
      configuration: { sectionId: 'from-the-node' },
    });
  });

  /*
   * The node and the rule's denormalised columns have been able to disagree, so
   * which one wins is a decision rather than a detail.
   */
  it('falls back to the rule’s columns when the tree has no trigger node', () => {
    const { trigger } = convert([node({ id: 'a', nodeType: 'ACTION', subtype: 'UNASSIGN_USER' })]);

    expect(trigger).toEqual({
      type: 'TASK_CREATED',
      configuration: { sectionId: 'from-the-rule' },
    });
  });
});

describe('a flat rule', () => {
  const flat = () => [
    node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', position: 0 }),
    node({
      id: 'c1',
      nodeType: 'CONDITION',
      subtype: 'status',
      configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
      position: 1,
    }),
    node({
      id: 'a1',
      nodeType: 'ACTION',
      subtype: 'ASSIGN_USER',
      configuration: { userId: 'someone' },
      position: 2,
    }),
    node({ id: 'a2', nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', position: 3 }),
  ];

  it('becomes one PRIMARY branch', () => {
    const { branches } = convert(flat());

    expect(branches).toHaveLength(1);
    expect(branches[0]?.type).toBe(AutomationBranchType.PRIMARY);
    expect(branches[0]?.position).toBe(0);
  });

  /* `ALL` is what the runner does with a flat rule — it stops at the first
   * condition that does not hold — so any other operator would change what the
   * rule does on its first read. */
  it('puts its conditions in an ALL group', () => {
    const { branches } = convert(flat());

    expect(branches[0]?.conditionGroup?.operator).toBe(ConditionGroupOperator.ALL);
    expect(branches[0]?.conditionGroup?.conditions).toEqual([
      expect.objectContaining({ fieldKey: 'status', operator: 'IS', value: 'DONE', position: 0 }),
    ]);
  });

  it('keeps its actions in order, renumbered from zero', () => {
    const { branches } = convert(flat());

    expect(branches[0]?.actions.map((action) => [action.actionType, action.position])).toEqual([
      ['ASSIGN_USER', 0],
      ['CLEAR_DUE_DATE', 1],
    ]);
  });

  /* A rule that was never given a condition has no group, rather than an empty
   * one — the two are both unpublishable but say different things. */
  it('has no condition group when it had no conditions', () => {
    const { branches } = convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED' }),
      node({ id: 'a1', nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', position: 1 }),
    ]);

    expect(branches[0]?.conditionGroup).toBeNull();
  });

  it('orders by position rather than by the order the rows arrived in', () => {
    const shuffled = [flat()[3]!, flat()[1]!, flat()[0]!, flat()[2]!];
    const { branches } = convert(shuffled);

    expect(branches[0]?.actions.map((action) => action.actionType)).toEqual([
      'ASSIGN_USER',
      'CLEAR_DUE_DATE',
    ]);
  });
});

describe('a condition’s comparison', () => {
  const conditionWith = (configuration: Record<string, unknown>, subtype = 'status') =>
    convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED' }),
      node({ id: 'c', nodeType: 'CONDITION', subtype, configuration, position: 1 }),
      node({ id: 'a', nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', position: 2 }),
    ]).branches[0]?.conditionGroup?.conditions[0];

  it.each([
    ['EQUALS', 'IS'],
    ['NOT_EQUALS', 'IS_NOT'],
    ['NOT_CONTAINS', 'DOES_NOT_CONTAIN'],
    ['IN', 'IS_ONE_OF'],
    ['NOT_IN', 'IS_NOT_ONE_OF'],
    ['BEFORE', 'IS_BEFORE'],
    ['AFTER', 'IS_AFTER'],
  ])('translates the filter operator %s into %s', (legacy, expected) => {
    expect(conditionWith({ operator: legacy, value: 'x' })?.operator).toBe(expected);
  });

  /*
   * Passed through rather than guessed at, so it surfaces as a comparison
   * nothing understands instead of being silently rewritten into one the rule
   * never made.
   */
  it('leaves an operator it has no word for alone', () => {
    expect(conditionWith({ operator: 'SOUNDS_LIKE', value: 'x' })?.operator).toBe('SOUNDS_LIKE');
  });

  /* The runner reads `config.field ?? node.subtype`, so a condition saved with
   * only a subtype still compares the field it named. */
  it('falls back to the subtype when the configuration names no field', () => {
    expect(conditionWith({ operator: 'EQUALS', value: 'HIGH' }, 'priority')?.fieldKey).toBe(
      'priority',
    );
  });

  it('stores a missing value as null rather than dropping it', () => {
    expect(conditionWith({ operator: 'IS_EMPTY' })?.value).toBeNull();
  });
});

describe('a branch chain', () => {
  /**
   * The shape "otherwise if" had to be built as: a branch whose else arm holds
   * another branch, whose else arm holds the fallback actions.
   */
  const chain = (): LegacyNode[] => [
    node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', position: 0 }),
    node({
      id: 'b1',
      nodeType: 'BRANCH',
      subtype: 'status',
      configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
      parentNodeId: 't',
      position: 1,
    }),
    node({
      id: 'a1',
      nodeType: 'ACTION',
      subtype: 'ADD_COMMENT',
      configuration: { body: 'done' },
      parentNodeId: 'b1',
      branchKey: BranchKey.MATCH,
      position: 0,
    }),
    node({
      id: 'b2',
      nodeType: 'BRANCH',
      subtype: 'priority',
      configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
      parentNodeId: 'b1',
      branchKey: BranchKey.ELSE,
      position: 1,
    }),
    node({
      id: 'a2',
      nodeType: 'ACTION',
      subtype: 'ADD_COMMENT',
      configuration: { body: 'urgent' },
      parentNodeId: 'b2',
      branchKey: BranchKey.MATCH,
      position: 0,
    }),
    node({
      id: 'a3',
      nodeType: 'ACTION',
      subtype: 'ADD_COMMENT',
      configuration: { body: 'neither' },
      parentNodeId: 'b2',
      branchKey: BranchKey.ELSE,
      position: 1,
    }),
  ];

  it('becomes PRIMARY, OTHERWISE_IF and OTHERWISE in chain order', () => {
    const { branches } = convert(chain());

    expect(branches.map((branch) => [branch.type, branch.position])).toEqual([
      [AutomationBranchType.PRIMARY, 0],
      [AutomationBranchType.OTHERWISE_IF, 1],
      [AutomationBranchType.OTHERWISE, 2],
    ]);
  });

  it('gives each branch the comparison of the BRANCH node it came from', () => {
    const { branches } = convert(chain());

    expect(branches[0]?.conditionGroup?.conditions).toEqual([
      expect.objectContaining({ fieldKey: 'status', operator: 'IS', value: 'DONE' }),
    ]);
    expect(branches[1]?.conditionGroup?.conditions).toEqual([
      expect.objectContaining({ fieldKey: 'priority', operator: 'IS', value: 'HIGH' }),
    ]);
  });

  it('gives each branch the actions from its matched arm', () => {
    const { branches } = convert(chain());

    expect(branches.map((branch) => branch.actions.map((it) => it.configuration['body']))).toEqual([
      ['done'],
      ['urgent'],
      ['neither'],
    ]);
  });

  /* The model refuses a condition on OTHERWISE, and the tree never gave it one. */
  it('leaves OTHERWISE without a condition group', () => {
    const { branches } = convert(chain());

    expect(branches[2]?.conditionGroup).toBeNull();
  });

  it('leaves no OTHERWISE at all when the last else arm is empty', () => {
    const { branches } = convert(chain().filter((it) => it.id !== 'a3'));

    expect(branches.map((branch) => branch.type)).toEqual([
      AutomationBranchType.PRIMARY,
      AutomationBranchType.OTHERWISE_IF,
    ]);
  });
});

describe('a condition above the chain', () => {
  /**
   * A condition between the trigger and the first branch gated everything below
   * it, including the else arm. Carried into every branch, `OTHERWISE_IF { gate
   * ∧ c }` is reached exactly when the gate held and nothing above it matched —
   * which is what the tree meant.
   */
  const gated = (): LegacyNode[] => [
    node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', position: 0 }),
    node({
      id: 'c',
      nodeType: 'CONDITION',
      subtype: 'assigneeId',
      configuration: { field: 'assigneeId', operator: 'IS_NOT_EMPTY' },
      parentNodeId: 't',
      position: 1,
    }),
    node({
      id: 'b1',
      nodeType: 'BRANCH',
      subtype: 'status',
      configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
      parentNodeId: 'c',
      position: 0,
    }),
    node({
      id: 'a1',
      nodeType: 'ACTION',
      subtype: 'CLEAR_DUE_DATE',
      parentNodeId: 'b1',
      branchKey: BranchKey.MATCH,
      position: 0,
    }),
    node({
      id: 'a2',
      nodeType: 'ACTION',
      subtype: 'UNASSIGN_USER',
      parentNodeId: 'b1',
      branchKey: BranchKey.ELSE,
      position: 0,
    }),
  ];

  it('is ANDed into every branch it gated', () => {
    const { branches } = convert(gated());

    expect(branches[0]?.conditionGroup?.conditions.map((it) => it.fieldKey)).toEqual([
      'assigneeId',
      'status',
    ]);
  });

  /*
   * The fallback stays an OTHERWISE_IF. `OTHERWISE` runs when nothing above it
   * matched, full stop — it would fire on tasks the gate excluded, which the
   * tree never touched.
   */
  it('keeps the fallback conditional rather than making it an OTHERWISE', () => {
    const { branches } = convert(gated());

    expect(branches[1]?.type).toBe(AutomationBranchType.OTHERWISE_IF);
    expect(branches[1]?.conditionGroup?.conditions.map((it) => it.fieldKey)).toEqual([
      'assigneeId',
    ]);
    expect(branches[1]?.actions.map((it) => it.actionType)).toEqual(['UNASSIGN_USER']);
  });
});

describe('an action above the chain', () => {
  /* It ran unconditionally, so it is prepended to every branch below it. */
  it('is prepended to every branch, ahead of that branch’s own actions', () => {
    const { branches } = convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', position: 0 }),
      node({
        id: 'a0',
        nodeType: 'ACTION',
        subtype: 'CLEAR_DUE_DATE',
        parentNodeId: 't',
        position: 0,
      }),
      node({
        id: 'b1',
        nodeType: 'BRANCH',
        subtype: 'status',
        configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
        parentNodeId: 'a0',
        position: 0,
      }),
      node({
        id: 'a1',
        nodeType: 'ACTION',
        subtype: 'UNASSIGN_USER',
        parentNodeId: 'b1',
        branchKey: BranchKey.MATCH,
        position: 0,
      }),
      node({
        id: 'a2',
        nodeType: 'ACTION',
        subtype: 'ADD_COMMENT',
        parentNodeId: 'b1',
        branchKey: BranchKey.ELSE,
        position: 0,
      }),
    ]);

    expect(branches.map((branch) => branch.actions.map((it) => it.actionType))).toEqual([
      ['CLEAR_DUE_DATE', 'UNASSIGN_USER'],
      ['CLEAR_DUE_DATE', 'ADD_COMMENT'],
    ]);
    expect(branches[0]?.actions.map((it) => it.position)).toEqual([0, 1]);
  });
});

describe('a chained rule with no branch', () => {
  /* Parentage without a branch is a flat rule that happens to be a chain. */
  it('becomes one PRIMARY branch holding everything on the path', () => {
    const { branches } = convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', position: 0 }),
      node({
        id: 'c',
        nodeType: 'CONDITION',
        subtype: 'status',
        configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
        parentNodeId: 't',
        position: 0,
      }),
      node({
        id: 'a',
        nodeType: 'ACTION',
        subtype: 'CLEAR_DUE_DATE',
        parentNodeId: 'c',
        position: 0,
      }),
    ]);

    expect(branches).toHaveLength(1);
    expect(branches[0]?.type).toBe(AutomationBranchType.PRIMARY);
    expect(branches[0]?.conditionGroup?.conditions).toHaveLength(1);
    expect(branches[0]?.actions).toHaveLength(1);
  });
});

describe('what could not be carried across', () => {
  /* Named rather than dropped in silence: a rule that quietly means something
   * new after conversion is the failure the phased plan exists to avoid. */
  it('reports a delay, which the branch model has no step for', () => {
    const { notes } = convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED' }),
      node({ id: 'd', nodeType: 'DELAY', subtype: 'WAIT', position: 1 }),
    ]);

    expect(notes).toEqual([expect.stringContaining('delay')]);
  });

  it('reports a branch nested inside another branch’s matched arm', () => {
    const { notes } = convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', position: 0 }),
      node({
        id: 'b1',
        nodeType: 'BRANCH',
        subtype: 'status',
        configuration: { operator: 'EQUALS', value: 'DONE' },
        parentNodeId: 't',
        position: 1,
      }),
      node({
        id: 'b2',
        nodeType: 'BRANCH',
        subtype: 'priority',
        configuration: { operator: 'EQUALS', value: 'HIGH' },
        parentNodeId: 'b1',
        branchKey: BranchKey.MATCH,
        position: 0,
      }),
    ]);

    expect(notes).toEqual([expect.stringContaining('nested inside')]);
  });

  it('reports a tree with no trigger, and returns an empty branch rather than nothing', () => {
    const { branches, notes } = convert([
      node({ id: 'a', nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', parentNodeId: 'gone' }),
    ]);

    expect(notes).toEqual([expect.stringContaining('no trigger step')]);
    expect(branches).toHaveLength(1);
    expect(branches[0]?.type).toBe(AutomationBranchType.PRIMARY);
  });

  it('says nothing when a rule converts intact', () => {
    const { notes } = convert([
      node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED' }),
      node({ id: 'a', nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', position: 1 }),
    ]);

    expect(notes).toEqual([]);
  });
});

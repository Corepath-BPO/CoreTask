import { AutomationNodeType, BranchKey, ConditionValueKind } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import {
  deriveEdges,
  operatorFitsValueKind,
  validateCondition,
  validateGraphStructure,
} from './automation-graph.js';

type Node = Parameters<typeof validateGraphStructure>[0][number];

const node = (over: Partial<Node> = {}): Node => ({
  id: 'n-1',
  type: AutomationNodeType.ACTION,
  subtype: 'ASSIGN_USER',
  configuration: {},
  parentId: 'trigger-1',
  branchKey: null,
  ...over,
});

const trigger = (): Node =>
  node({
    id: 'trigger-1',
    type: AutomationNodeType.TRIGGER,
    subtype: 'TASK_CREATED',
    parentId: null,
  });

const messages = (nodes: Node[], name = 'A rule') =>
  validateGraphStructure(nodes, name).map((issue) => issue.message);

describe('deriving edges from parentage', () => {
  it('connects a child to its parent', () => {
    const edges = deriveEdges([
      { id: 't', type: AutomationNodeType.TRIGGER, parentId: null, branchKey: null, order: 0 },
      { id: 'a', type: AutomationNodeType.ACTION, parentId: 't', branchKey: null, order: 1 },
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 't', target: 'a', kind: 'DEFAULT', label: null });
  });

  it('labels each arm leaving a branch', () => {
    // "Next" needs no label; which way out of a split very much does.
    const edges = deriveEdges([
      { id: 'b', type: AutomationNodeType.BRANCH, parentId: null, branchKey: null, order: 0 },
      {
        id: 'm',
        type: AutomationNodeType.ACTION,
        parentId: 'b',
        branchKey: BranchKey.MATCH,
        order: 1,
      },
      {
        id: 'e',
        type: AutomationNodeType.ACTION,
        parentId: 'b',
        branchKey: BranchKey.ELSE,
        order: 2,
      },
    ]);

    expect(edges.find((edge) => edge.target === 'm')).toMatchObject({
      kind: 'MATCH',
      label: 'If it matches',
    });
    expect(edges.find((edge) => edge.target === 'e')).toMatchObject({
      kind: 'ELSE',
      label: 'Otherwise',
    });
  });

  it('draws nothing for a parent that is not in the graph', () => {
    // A dangling reference is a validation error, not an edge to nowhere — and
    // an edge to a missing node crashes the canvas rather than reporting it.
    expect(
      deriveEdges([{ id: 'a', type: 'ACTION', parentId: 'gone', branchKey: null, order: 0 }]),
    ).toEqual([]);
  });
});

describe('graph structure', () => {
  it('accepts the smallest useful rule', () => {
    const issues = validateGraphStructure([trigger(), node()], 'Assign incoming');

    expect(issues.filter((issue) => issue.level === 'ERROR')).toEqual([]);
  });

  it('wants a name', () => {
    expect(messages([trigger(), node()], '')).toContain('Give the rule a name.');
    expect(messages([trigger(), node()], '   ')).toContain('Give the rule a name.');
  });

  it('wants a trigger and an action', () => {
    expect(messages([node({ parentId: null })])).toContain('Choose what starts this rule.');
    expect(messages([trigger()])).toContain('Add at least one action.');
  });

  it('refuses a second trigger', () => {
    const second = { ...trigger(), id: 'trigger-2' };

    expect(messages([trigger(), second, node()])).toContain('A rule can only start one way.');
  });

  it('refuses a placeholder, which is the absence of an action', () => {
    // Fine in a draft; publishing one hands the runner a step it cannot perform.
    expect(messages([trigger(), node({ id: 'p', type: 'PLACEHOLDER' })])).toContain(
      'Finish choosing this action, or remove it.',
    );
  });

  it('refuses a step with no parent', () => {
    expect(messages([trigger(), node({ id: 'orphan', parentId: null })])).toContain(
      'This step is not connected to anything.',
    );
  });

  it('refuses a step whose parent is gone', () => {
    expect(messages([trigger(), node({ parentId: 'deleted' })])).toContain(
      'This step follows something that is no longer here.',
    );
  });

  it('refuses steps that loop back into each other', () => {
    /*
     * The builder cannot draw one, but the endpoint accepts a graph from
     * anywhere — and a cycle makes the runner walk forever rather than merely
     * produce a wrong answer.
     */
    const a = node({ id: 'a', parentId: 'b' });
    const b = node({ id: 'b', parentId: 'a' });

    expect(messages([trigger(), a, b])).toContain('These steps loop back into each other.');
  });

  it('warns about a rule with no condition rather than refusing it', () => {
    // Running every time is a legitimate rule, and worth saying out loud.
    const issues = validateGraphStructure([trigger(), node()], 'A rule');
    const warning = issues.find((issue) => issue.level === 'WARNING');

    expect(warning?.message).toMatch(/runs every time/);
    expect(issues.some((issue) => issue.level === 'ERROR')).toBe(false);
  });

  it('refuses a split with nothing under it', () => {
    const branch = node({ id: 'b', type: AutomationNodeType.BRANCH, subtype: 'IF_ELSE' });

    expect(messages([trigger(), branch, node()])).toContain('This split has no steps under it.');
  });

  it('refuses an arm with no branch key', () => {
    const branch = node({ id: 'b', type: AutomationNodeType.BRANCH, subtype: 'IF_ELSE' });
    const arm = node({ id: 'arm', parentId: 'b', branchKey: null });

    expect(messages([trigger(), branch, arm])).toContain(
      'This step is under a split but not on one of its paths.',
    );
  });
});

describe('type-aware operators', () => {
  it('allows contains on text and refuses it on a date', () => {
    // "Date contains High" is the combination a form should never offer — and
    // the endpoint has to refuse it too, because a form is not a check.
    expect(operatorFitsValueKind('CONTAINS', ConditionValueKind.TEXT)).toBe(true);
    expect(operatorFitsValueKind('CONTAINS', ConditionValueKind.DATE)).toBe(false);
  });

  it('refuses greater-than on a checkbox', () => {
    expect(operatorFitsValueKind('GREATER_THAN', ConditionValueKind.BOOLEAN)).toBe(false);
    expect(operatorFitsValueKind('GREATER_THAN', ConditionValueKind.NUMBER)).toBe(true);
  });
});

describe('condition configuration', () => {
  const paths = (config: Record<string, unknown>, kind?: ConditionValueKind) =>
    validateCondition(config, kind, 'n-1').map((issue) => issue.path);

  it('wants a field, an operator and a value', () => {
    expect(paths({})).toEqual(['field']);
    expect(paths({ field: 'priority' })).toEqual(['operator']);
    expect(paths({ field: 'priority', operator: 'EQUALS' }, ConditionValueKind.ENUM)).toEqual([
      'value',
    ]);
  });

  it('needs no value for an emptiness check', () => {
    expect(
      paths({ field: 'assigneeId', operator: 'IS_EMPTY' }, ConditionValueKind.REFERENCE),
    ).toEqual([]);
  });

  it('reports a field the project no longer has', () => {
    const issues = validateCondition({ field: 'gone', operator: 'EQUALS' }, undefined, 'n-1');

    expect(issues[0]?.message).toMatch(/no longer available/);
  });

  it('reports an operator that does not fit the field', () => {
    const issues = validateCondition(
      { field: 'dueDate', operator: 'CONTAINS', value: 'x' },
      ConditionValueKind.DATE,
      'n-1',
    );

    expect(issues[0]?.path).toBe('operator');
  });

  it('refuses a condition nobody has answered', () => {
    /*
     * The default shape of a new rule. It used to publish cleanly and then skip
     * every event for the rest of its life, because a missing operator reads as
     * an unknown one and an unknown one is false.
     */
    const issues = validateGraphStructure(
      [
        {
          id: 't',
          type: 'TRIGGER',
          subtype: 'TASK_CREATED',
          configuration: {},
          parentId: null,
          branchKey: null,
        },
        {
          id: 'c',
          type: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: {},
          parentId: 't',
          branchKey: null,
        },
        {
          id: 'a',
          type: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: {},
          parentId: 'c',
          branchKey: null,
        },
      ],
      'A rule',
    );

    expect(issues.some((issue) => issue.nodeId === 'c' && issue.path === 'field')).toBe(true);
  });

  it('refuses a condition with a field but no comparison', () => {
    const issues = validateGraphStructure(
      [
        {
          id: 't',
          type: 'TRIGGER',
          subtype: 'TASK_CREATED',
          configuration: {},
          parentId: null,
          branchKey: null,
        },
        {
          id: 'c',
          type: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'status' },
          parentId: 't',
          branchKey: null,
        },
        {
          id: 'a',
          type: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: {},
          parentId: 'c',
          branchKey: null,
        },
      ],
      'A rule',
    );

    expect(issues.some((issue) => issue.nodeId === 'c' && issue.path === 'operator')).toBe(true);
  });

  it('accepts a condition that was answered', () => {
    const issues = validateGraphStructure(
      [
        {
          id: 't',
          type: 'TRIGGER',
          subtype: 'TASK_CREATED',
          configuration: {},
          parentId: null,
          branchKey: null,
        },
        {
          id: 'c',
          type: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
          parentId: 't',
          branchKey: null,
        },
        {
          id: 'a',
          type: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: {},
          parentId: 'c',
          branchKey: null,
        },
      ],
      'A rule',
    );

    expect(issues.filter((issue) => issue.nodeId === 'c')).toEqual([]);
  });
});

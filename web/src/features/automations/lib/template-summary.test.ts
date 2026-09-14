import type { AutomationTemplateNode } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { describeUnresolved, summariseTemplate } from './template-summary';

const node = (over: Partial<AutomationTemplateNode>): AutomationTemplateNode => ({
  id: 'n',
  nodeType: 'ACTION',
  subtype: 'ASSIGN_USER',
  configuration: {},
  position: { x: 0, y: 0 },
  parentId: null,
  branchKey: null,
  order: 0,
  ...over,
});

describe('summariseTemplate', () => {
  it('reads the trigger from the node and the steps in runner order', () => {
    const summary = summariseTemplate({
      triggerType: 'TASK_CREATED',
      nodes: [
        // Stored out of order and parented: the walk, not the array, decides.
        node({ id: 'a2', subtype: 'MOVE_TO_SECTION', parentId: 'a1', order: 3 }),
        node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', order: 0 }),
        node({
          id: 'c',
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'priority', operator: 'IS', value: 'HIGH' },
          parentId: 't',
          order: 1,
        }),
        node({ id: 'a1', subtype: 'ASSIGN_USER', parentId: 'c', order: 2 }),
      ],
    });

    expect(summary.trigger).toBe('When a task is moved to a section');
    expect(summary.steps.map((step) => step.label)).toEqual([
      'Check if priority is …',
      'Assign a person',
      'Move to a section',
    ]);
    expect(summary.actionCount).toBe(2);
  });

  it('names a fallback row and a custom-field check without an id', () => {
    const summary = summariseTemplate({
      triggerType: 'TASK_CREATED',
      nodes: [
        node({ id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED' }),
        node({
          id: 'c1',
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'customField:0192-abc', operator: 'IS_ONE_OF', value: [] },
          parentId: 't',
          order: 1,
        }),
        node({ id: 'a1', subtype: 'ADD_COMMENT', parentId: 'c1', order: 2 }),
        node({
          id: 'c2',
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { fallback: true },
          parentId: 't',
          order: 3,
        }),
        node({ id: 'a2', subtype: 'UNASSIGN_USER', parentId: 'c2', order: 4 }),
      ],
    });

    expect(summary.steps.map((step) => [step.kind, step.label])).toEqual([
      ['check', 'Check if a field is one of …'],
      ['action', 'Add a comment'],
      ['otherwise', 'Otherwise'],
      ['action', 'Remove the assignee'],
    ]);
  });

  it('falls back to the row’s trigger and stored order for a flat rule', () => {
    const summary = summariseTemplate({
      triggerType: 'TASK_COMPLETED',
      nodes: [
        node({ id: 'a', subtype: 'CLEAR_DUE_DATE', order: 1 }),
        node({ id: 'b', subtype: 'ADD_COMMENT', order: 0 }),
      ],
    });

    expect(summary.trigger).toBe('When a task is completed');
    expect(summary.steps.map((step) => step.label)).toEqual([
      'Add a comment',
      'Clear the due date',
    ]);
  });
});

describe('describeUnresolved', () => {
  it('says nothing when everything matched', () => {
    expect(describeUnresolved([])).toBe('');
  });

  it('names the kind, the step and the old name', () => {
    expect(
      describeUnresolved([
        { nodeType: 'ACTION', subtype: 'MOVE_TO_SECTION', kind: 'SECTION', name: 'Done' },
        {
          nodeType: 'TRIGGER',
          subtype: 'CUSTOM_FIELD_CHANGED',
          kind: 'CUSTOM_FIELD',
          name: 'Risk',
        },
        { nodeType: 'CONDITION', subtype: 'FIELD_COMPARISON', kind: 'OPTION', name: 'Large' },
      ]),
    ).toBe(
      'Choose for this project: a section for “Move to a section” (was Done); ' +
        'a field for “When a custom field changes” (was Risk); ' +
        'an option for “a condition” (was Large).',
    );
  });
});

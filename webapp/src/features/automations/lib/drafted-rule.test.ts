import type { AutomationDraft, SaveAutomationGraphNode } from '@coretask/types';
import { validateGraphStructure } from '@coretask/validation';
import { describe, expect, it } from 'vitest';

import { makeDraftNodes, readDraft } from './drafted-rule';

const node = (
  order: number,
  type: SaveAutomationGraphNode['type'],
  subtype: string,
  configuration: Record<string, unknown> = {},
): SaveAutomationGraphNode => ({
  id: `new-draft-${order}`,
  type,
  subtype,
  configuration,
  position: { x: 0, y: order * 160 },
  parentId: order === 0 ? null : `new-draft-${order - 1}`,
  branchKey: null,
  order,
});

const draft: AutomationDraft = {
  name: 'Week 1 to Sam, due Friday',
  description: null,
  // Out of order on purpose: the canvas follows `order`, not the array.
  nodes: [
    node(2, 'ACTION', 'SET_DUE_DATE', { weekdayNextWeek: 5 }),
    node(0, 'TRIGGER', 'TASK_MOVED_TO_SECTION', { form: 'SECTION_CHANGED_TO', sectionId: 'wk1' }),
    node(1, 'ACTION', 'ASSIGN_USER', { userId: 'sam' }),
  ],
  validation: { publishable: true, issues: [] },
  notes: [],
};

describe('drafted rules', () => {
  it('open as a trigger with each step under the one before, keyed afresh', () => {
    const nodes = makeDraftNodes(draft);

    expect(nodes.map((entry) => [entry.type, entry.subtype, entry.configuration])).toEqual([
      ['TRIGGER', 'TASK_MOVED_TO_SECTION', { form: 'SECTION_CHANGED_TO', sectionId: 'wk1' }],
      ['ACTION', 'ASSIGN_USER', { userId: 'sam' }],
      ['ACTION', 'SET_DUE_DATE', { weekdayNextWeek: 5 }],
    ]);
    expect(nodes[1]?.parentId).toBe(nodes[0]?.id);
    expect(nodes[2]?.parentId).toBe(nodes[1]?.id);
    expect(nodes.every((entry) => entry.id.startsWith('new-') && !entry.id.includes('draft'))).toBe(
      true,
    );

    const errors = validateGraphStructure(
      nodes.map((entry) => ({
        id: entry.id,
        type: entry.type,
        subtype: entry.subtype,
        configuration: entry.configuration,
        parentId: entry.parentId,
        branchKey: entry.branchKey,
        order: entry.order,
      })),
      draft.name,
    ).filter((issue) => issue.level === 'ERROR');
    expect(errors).toEqual([]);
  });

  it('give a clock trigger the timezone a hand-picked one starts with, under what was drafted', () => {
    const [trigger] = makeDraftNodes({
      ...draft,
      nodes: [node(0, 'TRIGGER', 'DUE_DATE_APPROACHING', { days: 3 })],
    });

    expect(trigger?.configuration).toEqual({ timezone: expect.any(String), days: 3 });
  });

  it('come back out of a history entry only when they look like one', () => {
    expect(readDraft(draft)).toBe(draft);
    expect(readDraft(undefined)).toBeUndefined();
    expect(readDraft({ name: 'No nodes' })).toBeUndefined();
    expect(readDraft({ ...draft, nodes: [node(1, 'ACTION', 'ASSIGN_USER')] })).toBeUndefined();
    expect(readDraft({ ...draft, nodes: [{ type: 'TRIGGER' }] })).toBeUndefined();
  });
});

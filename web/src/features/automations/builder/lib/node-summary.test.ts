import type { AutomationMetadata } from '@coretask/types';

import type { CanvasNode } from './graph-edits';
import { describe, expect, it } from 'vitest';

import { isNodeIncomplete, summarise } from './node-summary';

const metadata = {
  triggers: [],
  actions: [],
  conditionFields: [
    {
      field: 'priority',
      label: 'Priority',
      valueKind: 'ENUM' as const,
      options: [{ value: 'HIGH', label: 'High' }],
    },
    { field: 'dueDate', label: 'Due date', valueKind: 'DATE' as const },
  ],
  sections: [{ id: 'sec-1', name: 'Incoming Request' }],
  statuses: [{ id: 'st-1', name: 'In Progress', colorToken: 'blue' }],
  priorities: [{ id: 'pr-1', name: 'High', colorToken: 'orange' }],
  members: [{ id: 'u-1', name: 'Maya Okafor', email: 'maya@example.com', avatarUrl: null }],
  customFields: [],
} as AutomationMetadata;

const node = (over: Partial<CanvasNode>): CanvasNode =>
  ({
    id: 'n-1',
    type: 'ACTION',
    subtype: 'ASSIGN_USER',
    configuration: {},
    position: { x: 0, y: 0 },
    parentId: null,
    branchKey: null,
    order: 0,
    ...over,
  }) as CanvasNode;

describe('what a node says', () => {
  it('names the section a trigger watches', () => {
    // "Task is moved to a section — 019fc8d5-…" is a node nobody can read.
    const summary = summarise(
      node({
        type: 'TRIGGER',
        subtype: 'TASK_MOVED_TO_SECTION',
        configuration: { sectionId: 'sec-1' },
      }),
      metadata,
    );

    expect(summary).toContain('Incoming Request');
  });

  it('names the person an action assigns to', () => {
    expect(summarise(node({ configuration: { userId: 'u-1' } }), metadata)).toBe(
      'Assign to Maya Okafor',
    );
  });

  it('says a reference is gone rather than printing its id', () => {
    /*
     * Falling back to the raw id makes a broken rule look merely technical,
     * when what it needs is for somebody to notice the section was deleted.
     */
    expect(summarise(node({ configuration: { userId: 'u-deleted' } }), metadata)).toBe(
      'Assign to somebody who has left',
    );
    expect(
      summarise(
        node({ subtype: 'MOVE_TO_SECTION', configuration: { sectionId: 'gone' } }),
        metadata,
      ),
    ).toBe('Move to a section that was removed');
  });

  it('asks for what is missing rather than showing a bare label', () => {
    expect(summarise(node({ configuration: {} }), metadata)).toBe('Assign — choose somebody');
  });

  it('reads a condition as a sentence, with the option’s label', () => {
    const summary = summarise(
      node({
        type: 'CONDITION',
        subtype: 'FIELD_COMPARISON',
        configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
      }),
      metadata,
    );

    expect(summary).toBe('Priority is High');
  });

  it('drops the value for an emptiness check', () => {
    // "Assignee is empty …" would read as an unfinished sentence.
    const summary = summarise(
      node({
        type: 'CONDITION',
        configuration: { field: 'dueDate', operator: 'IS_EMPTY' },
      }),
      metadata,
    );

    expect(summary).toBe('Due date is empty');
  });

  it('still reads without metadata, rather than rendering nothing', () => {
    // The canvas paints before the metadata query lands; a node blank for that
    // moment looks like a node that failed.
    const summary = summarise(
      node({ type: 'TRIGGER', subtype: 'TASK_CREATED', configuration: {} }),
      undefined,
    );

    expect(summary.length).toBeGreaterThan(0);
  });
});

describe('which nodes are flagged incomplete', () => {
  it('flags an action with nothing chosen', () => {
    expect(isNodeIncomplete(node({ configuration: {} }))).toBe(true);
    expect(isNodeIncomplete(node({ configuration: { userId: 'u-1' } }))).toBe(false);
  });

  it('flags a condition missing its comparison', () => {
    expect(
      isNodeIncomplete(
        node({
          type: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'priority' },
        }),
      ),
    ).toBe(true);
  });

  it('judges a node by its category, not by a subtype it happens to share', () => {
    // Switching on subtype alone judged a condition by an action's rule.
    expect(
      isNodeIncomplete(
        node({
          type: 'CONDITION',
          subtype: 'ASSIGN_USER',
          configuration: { field: 'priority', operator: 'IS_EMPTY' },
        }),
      ),
    ).toBe(false);
  });

  it('does not ask an emptiness check for a value', () => {
    expect(
      isNodeIncomplete(
        node({
          type: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'dueDate', operator: 'IS_EMPTY' },
        }),
      ),
    ).toBe(false);
  });
});

describe('values that match no option', () => {
  it('humanises a legacy enum rather than shouting it', () => {
    /*
     * The metadata offers definition ids, and a condition may legitimately hold
     * an enum — that is what the runner compares against for a task the
     * definition backfill has not reached. "Priority is HIGH" is the card
     * shouting an implementation detail.
     */
    const summary = summarise(
      node({
        type: 'CONDITION',
        subtype: 'FIELD_COMPARISON',
        configuration: { field: 'priority', operator: 'EQUALS', value: 'IN_PROGRESS' },
      }),
      metadata,
    );

    expect(summary).toBe('Priority is In progress');
  });

  it('leaves ordinary text alone', () => {
    const summary = summarise(
      node({
        type: 'CONDITION',
        subtype: 'FIELD_COMPARISON',
        configuration: { field: 'title', operator: 'CONTAINS', value: 'urgent fix' },
      }),
      metadata,
    );

    expect(summary).toContain('urgent fix');
  });
});

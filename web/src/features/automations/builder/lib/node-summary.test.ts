import type { AutomationMetadata } from '@coretask/types';

import type { CanvasNode } from './graph-edits';
import { describe, expect, it } from 'vitest';

import { isNodeIncomplete, nodeCategory, nodeHeading, summarise } from './node-summary';

const metadata = {
  triggers: [],
  actions: [],
  conditions: [],
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
  projects: [
    {
      id: 'proj-2',
      name: 'Renewals',
      color: '#a855f7',
      sections: [{ id: 'sec-9', name: 'Notify Tenant' }],
    },
  ],
  statuses: [{ id: 'st-1', name: 'In Progress', colorToken: 'blue' }],
  priorities: [{ id: 'pr-1', name: 'High', colorToken: 'orange' }],
  members: [{ id: 'u-1', name: 'Maya Okafor', email: 'maya@example.com', avatarUrl: null }],
  customFields: [],
  webhookEndpoints: [{ id: 'wh-1', name: 'n8n', host: 'n8n.example.com', enabled: true }],
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
    expect(summarise(node({ subtype: 'MOVE_TO_PROJECT', configuration: {} }), metadata)).toBe(
      'Move — choose a project',
    );
  });

  it('reads a move to another project as the project, then its section', () => {
    const move = (configuration: Record<string, unknown>) =>
      summarise(node({ subtype: 'MOVE_TO_PROJECT', configuration }), metadata);

    // The section is optional, so the project alone is a complete sentence.
    expect(move({ projectId: 'proj-2' })).toBe('Move to Renewals');
    expect(move({ projectId: 'proj-2', targetSectionId: 'sec-9' })).toBe(
      'Move to Renewals › Notify Tenant',
    );
    // Looked up in the *target* project's sections: this project's section of
    // the same id would be a different column.
    expect(move({ projectId: 'proj-2', targetSectionId: 'sec-1' })).toBe('Move to Renewals');
    expect(move({ projectId: 'proj-gone' })).toBe('Move to a project that was removed');
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

  it('flags a subtask step whose dated row has no date yet', () => {
    const subtasks = (rows: unknown[]) =>
      node({ subtype: 'CREATE_SUBTASK', configuration: { subtasks: rows } });

    expect(isNodeIncomplete(subtasks([{ title: 'Review', dueDate: '' }]))).toBe(true);
    expect(
      isNodeIncomplete(subtasks([{ title: 'Review', dueDate: '2030-01-15', assigneeId: 'u-1' }])),
    ).toBe(false);
    expect(isNodeIncomplete(subtasks(['Review', { title: 'Sign off', dueInDays: 3 }]))).toBe(false);
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

describe('the branch rows', () => {
  const fallback = () =>
    node({ type: 'CONDITION', subtype: 'FIELD_COMPARISON', configuration: { fallback: true } });

  it('says what the fallback is for, because it checks nothing', () => {
    expect(nodeHeading(fallback())).toBe('Otherwise');
    expect(summarise(fallback(), metadata)).toBe('If all other conditions are not met');
  });

  it('never flags the fallback as unfinished', () => {
    // It has nothing to answer, so flagging it would put a red border and a
    // count beside Publish on the one row that is complete by definition.
    expect(isNodeIncomplete(fallback())).toBe(false);
  });

  it('reads an unanswered second row as the offer somebody clicked, on one line', () => {
    /*
     * "Otherwise if" above "+ Otherwise if…" is the same words twice, on the
     * one card whose whole job is to be a single line and an invitation.
     */
    const row = node({ type: 'CONDITION', subtype: 'FIELD_COMPARISON', configuration: {} });

    expect(summarise(row, metadata, { alternative: true })).toBe('+ Otherwise if…');
    expect(nodeHeading(row, { alternative: true })).toBe('');
  });

  it('leaves the rule’s own first question alone', () => {
    /*
     * The default shape of a new rule is an unanswered condition, and "+
     * Otherwise if…" on the first row would describe a branch that does not
     * exist yet.
     */
    const row = node({ type: 'CONDITION', subtype: 'FIELD_COMPARISON', configuration: {} });

    expect(summarise(row, metadata)).toBe('Choose what to check');
    expect(nodeHeading(row)).toBe('Check if');
  });

  it('reads an answered row as its comparison under “Otherwise if”', () => {
    // Only the first branch leads with the rule's question; every one after it
    // is an alternative to that question, and says so above its own comparison.
    const row = node({
      type: 'CONDITION',
      subtype: 'FIELD_COMPARISON',
      configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
    });

    expect(summarise(row, metadata, { alternative: true })).toBe('Priority is High');
    expect(nodeHeading(row, { alternative: true })).toBe('Otherwise if');
    expect(nodeHeading(row)).toBe('Check if');
  });

  it('names the fallback “Otherwise” wherever it sits', () => {
    // It is the case where nothing matched, which is not something that can be
    // asked first or last differently.
    expect(nodeCategory(fallback(), { alternative: true })).toBe('Otherwise');
    expect(nodeCategory(fallback())).toBe('Otherwise');
  });

  it('gives a branch the panel calls it by, even while unanswered', () => {
    // The card collapses to one line; the panel is where the question gets
    // answered, so its breadcrumb still has to say which branch this is.
    const row = node({ type: 'CONDITION', subtype: 'FIELD_COMPARISON', configuration: {} });

    expect(nodeCategory(row, { alternative: true })).toBe('Otherwise if');
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

describe('the send-a-webhook step', () => {
  it('names the endpoint, or the host of an ad-hoc URL — never the whole URL', () => {
    expect(
      summarise(node({ subtype: 'SEND_WEBHOOK', configuration: { endpointId: 'wh-1' } }), metadata),
    ).toBe('Send a webhook to n8n');
    expect(
      summarise(
        node({
          subtype: 'SEND_WEBHOOK',
          configuration: { url: 'https://hooks.example.com/abc123/secret-path' },
        }),
        metadata,
      ),
    ).toBe('Send a webhook to hooks.example.com');
    expect(
      summarise(node({ subtype: 'SEND_WEBHOOK', configuration: { endpointId: 'gone' } }), metadata),
    ).toBe('Send a webhook to an endpoint that was removed');
  });

  it('is incomplete until it has somewhere to send', () => {
    expect(isNodeIncomplete(node({ subtype: 'SEND_WEBHOOK', configuration: {} }))).toBe(true);
    expect(
      isNodeIncomplete(node({ subtype: 'SEND_WEBHOOK', configuration: { url: 'https://x.test' } })),
    ).toBe(false);
    expect(
      isNodeIncomplete(node({ subtype: 'SEND_WEBHOOK', configuration: { endpointId: 'wh-1' } })),
    ).toBe(false);
  });
});

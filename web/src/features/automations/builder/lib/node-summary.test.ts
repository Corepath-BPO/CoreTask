import type { AutomationMetadata } from '@coretask/types';

import type { CanvasNode } from './graph-edits';
import { describe, expect, it } from 'vitest';

import {
  isNodeIncomplete,
  nodeCategory,
  nodeHeading,
  summarise,
  summariseParts,
} from './node-summary';

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

  it('reads the ticket steps in the ticket’s words', () => {
    expect(
      summarise(
        node({ subtype: 'SET_TICKET_STATUS', configuration: { status: 'IN_PROGRESS' } }),
        metadata,
      ),
    ).toBe('Set ticket status to In progress');
    expect(summarise(node({ subtype: 'SET_TICKET_PRIORITY', configuration: {} }), metadata)).toBe(
      'Set ticket priority — choose one',
    );
  });

  it('reads an email step as who it goes to', () => {
    const email = (configuration: Record<string, unknown>) =>
      summarise(node({ subtype: 'SEND_EMAIL', configuration }), metadata);

    expect(email({ recipients: ['ASSIGNEE', 'CREATOR'], subject: 'Hi' })).toBe(
      'Email the assignee, whoever created the task',
    );
    expect(email({ subject: 'Hi' })).toBe('Email — choose who');
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
    // Adding keeps the task here as well, and says so.
    expect(move({ projectId: 'proj-2', mode: 'ADD' })).toBe('Add to Renewals');
    expect(move({ mode: 'ADD' })).toBe('Add — choose a project');
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

describe('the triggers that are not edits, and the newer actions', () => {
  it('reads a schedule as when and on what', () => {
    expect(
      summarise(
        node({
          type: 'TRIGGER',
          subtype: 'SCHEDULED_TIME',
          configuration: {
            frequency: 'WEEKLY',
            weekday: 5,
            time: '16:00',
            timezone: 'Europe/London',
            scope: 'SECTION',
            sectionId: 'sec-1',
          },
        }),
        metadata,
      ),
    ).toBe('Every Friday at 16:00 (Europe/London) · Incomplete tasks in a section');
  });

  it('says how far ahead an approaching date fires, and what a manual rule is called', () => {
    expect(
      summarise(
        node({ type: 'TRIGGER', subtype: 'DUE_DATE_APPROACHING', configuration: { days: 2 } }),
        metadata,
      ),
    ).toBe('When a task’s due date is approaching 2 days before');
    expect(
      summarise(
        node({ type: 'TRIGGER', subtype: 'START_DATE_APPROACHING', configuration: { days: 0 } }),
        metadata,
      ),
    ).toBe('When a task’s start date is approaching on the day');
    expect(
      summarise(
        node({
          type: 'TRIGGER',
          subtype: 'RUN_MANUALLY',
          configuration: { label: 'Send to legal' },
        }),
        metadata,
      ),
    ).toBe('When run from the menu as Send to legal');
  });

  it('names the custom date field a clock trigger watches', () => {
    const withField = {
      ...metadata,
      customFields: [{ id: 'cf-1', name: 'Lease ends', type: 'DATE' }],
    } as AutomationMetadata;
    expect(
      summarise(
        node({
          type: 'TRIGGER',
          subtype: 'CUSTOM_DATE_APPROACHING',
          configuration: { fieldId: 'cf-1', days: 3 },
        }),
        withField,
      ),
    ).toBe('When Lease ends is approaching 3 days before');
    expect(
      summarise(
        node({
          type: 'TRIGGER',
          subtype: 'CUSTOM_DATE_PASSED',
          configuration: { fieldId: 'cf-1' },
        }),
        withField,
      ),
    ).toBe('When Lease ends has passed');
    expect(
      summarise(
        node({ type: 'TRIGGER', subtype: 'CUSTOM_DATE_PASSED', configuration: {} }),
        withField,
      ),
    ).toBe('When a date field has passed');
  });

  it('reads the newer actions as what they do', () => {
    expect(summarise(node({ subtype: 'SET_COMPLETION', configuration: {} }), metadata)).toBe(
      'Mark complete',
    );
    expect(
      summarise(node({ subtype: 'SET_COMPLETION', configuration: { completed: false } }), metadata),
    ).toBe('Mark incomplete');
    expect(
      summarise(
        node({ subtype: 'CREATE_TASK', configuration: { title: 'Follow up: {{task.name}}' } }),
        metadata,
      ),
    ).toBe('Create task “Follow up: {{task.name}}”');
    expect(
      summarise(
        node({
          subtype: 'ADD_REMOVE_COLLABORATORS',
          configuration: { add: ['u-1'], remove: ['gone'] },
        }),
        metadata,
      ),
    ).toBe('Add Maya Okafor and remove somebody who has left');
    expect(summarise(node({ subtype: 'SET_TASK_DESCRIPTION', configuration: {} }), metadata)).toBe(
      'Clear the description',
    );
  });

  it('flags the newer actions until they say what to write or whom to add', () => {
    expect(isNodeIncomplete(node({ subtype: 'CREATE_TASK', configuration: {} }))).toBe(true);
    expect(isNodeIncomplete(node({ subtype: 'SET_TASK_NAME', configuration: { text: 'x' } }))).toBe(
      false,
    );
    expect(isNodeIncomplete(node({ subtype: 'ADD_REMOVE_COLLABORATORS', configuration: {} }))).toBe(
      true,
    );
    // Clearing is a real answer for a description.
    expect(isNodeIncomplete(node({ subtype: 'SET_TASK_DESCRIPTION', configuration: {} }))).toBe(
      false,
    );
  });
});

describe('the Wait step', () => {
  const wait = (configuration: Record<string, unknown>) =>
    node({ type: 'DELAY', subtype: 'DELAY', configuration });

  it('says how long it waits, the length set apart as the value', () => {
    expect(summarise(wait({ amount: 2, unit: 'DAYS' }), metadata)).toBe('Wait 2 days');
    expect(summarise(wait({ amount: 1, unit: 'HOURS' }), metadata)).toBe('Wait 1 hour');
    expect(summariseParts(wait({ amount: 30, unit: 'MINUTES' }), metadata)).toEqual([
      { text: 'Wait' },
      { text: '30 minutes', chip: true },
    ]);
  });

  it('asks how long until it knows, and is flagged until then', () => {
    expect(summarise(wait({}), metadata)).toBe('Wait — choose how long');
    expect(isNodeIncomplete(wait({}))).toBe(true);
    expect(isNodeIncomplete(wait({ amount: 91, unit: 'DAYS' }))).toBe(true);
    expect(isNodeIncomplete(wait({ amount: 1, unit: 'DAYS' }))).toBe(false);
  });
});

import { WorkItemType } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import {
  bulkWorkItemSchema,
  createWorkItemSchema,
  moveWorkItemSchema,
  projectWorkItemQuerySchema,
  updateWorkItemSchema,
} from './work-item.js';

const uuid = '019fc8d5-5365-76b1-b8bd-96599339f7ae';
const fieldId = '019fc8d5-5365-76b1-b8bd-96599339f7af';

describe('createWorkItemSchema', () => {
  it('accepts the types that have a model behind them', () => {
    for (const type of [WorkItemType.TASK, WorkItemType.TICKET]) {
      expect(createWorkItemSchema.safeParse({ type, title: 'A thing' }).success).toBe(true);
    }
  });

  it('refuses a type that cannot be stored yet', () => {
    // The picker disables Milestone, but a disabled control is not a check —
    // anything can post the body. Without this, a milestone would be written as
    // a task wearing a different label.
    for (const type of [WorkItemType.MILESTONE, WorkItemType.APPROVAL]) {
      const result = createWorkItemSchema.safeParse({ type, title: 'A thing' });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/only TASK and TICKET/i);
    }
  });

  it('refuses a blank or whitespace-only title', () => {
    expect(createWorkItemSchema.safeParse({ type: 'TASK', title: '   ' }).success).toBe(false);
  });

  it('trims the title rather than storing the spaces somebody typed', () => {
    const result = createWorkItemSchema.parse({ type: 'TASK', title: '  Ship it  ' });
    expect(result.title).toBe('Ship it');
  });

  it('takes a section, a parent and a sibling to land after', () => {
    const result = createWorkItemSchema.parse({
      type: 'TICKET',
      title: 'Login fails',
      sectionId: uuid,
      parentId: null,
      afterId: uuid,
    });

    expect(result.sectionId).toBe(uuid);
    expect(result.parentId).toBeNull();
  });

  it('refuses an id that is not one', () => {
    expect(
      createWorkItemSchema.safeParse({ type: 'TASK', title: 'x', sectionId: 'section-1' }).success,
    ).toBe(false);
  });
});

describe('status and priority references', () => {
  it('accepts a definition id', () => {
    expect(updateWorkItemSchema.safeParse({ statusId: uuid }).success).toBe(true);
  });

  it('accepts a legacy enum value, which is what the server hands out', () => {
    // A task with no backfilled definition, and every ticket, report their
    // status as an enum name. Refusing it here would break setting a status on
    // exactly the rows that have not been migrated.
    for (const value of ['IN_PROGRESS', 'RESOLVED', 'TODO', 'CRITICAL']) {
      expect(updateWorkItemSchema.safeParse({ statusId: value }).success).toBe(true);
    }
  });

  it('still refuses free text', () => {
    expect(updateWorkItemSchema.safeParse({ statusId: 'in progress' }).success).toBe(false);
    expect(updateWorkItemSchema.safeParse({ statusId: 'x' }).success).toBe(false);
  });
});

describe('updateWorkItemSchema', () => {
  it('refuses an update that changes nothing', () => {
    // A correlation id alone is bookkeeping, not a change. Accepting it would
    // write an activity entry and fire automations for an edit nobody made.
    expect(updateWorkItemSchema.safeParse({}).success).toBe(false);
    expect(updateWorkItemSchema.safeParse({ correlationId: 'abc' }).success).toBe(false);
  });

  it('accepts clearing a field, which is different from omitting it', () => {
    const result = updateWorkItemSchema.parse({ dueDate: null });
    expect(result.dueDate).toBeNull();
  });
});

describe('moveWorkItemSchema', () => {
  it('accepts a move to a section, and out of every section', () => {
    expect(moveWorkItemSchema.safeParse({ targetSectionId: uuid }).success).toBe(true);
    expect(moveWorkItemSchema.safeParse({ targetSectionId: null }).success).toBe(true);
  });

  it('refuses both an anchor before and after, which cannot both hold', () => {
    const result = moveWorkItemSchema.safeParse({
      targetSectionId: uuid,
      afterId: uuid,
      beforeId: uuid,
    });

    expect(result.success).toBe(false);
  });
});

describe('projectWorkItemQuerySchema', () => {
  it('reads types from one comma-separated parameter', () => {
    // Not a repeated one: axios serialises arrays as `types[]=`, which strict
    // validation rejects as an unknown property.
    const result = projectWorkItemQuerySchema.parse({ types: 'task,ticket' });
    expect(result.types).toEqual(['TASK', 'TICKET']);
  });

  it('leaves types undefined when the parameter is absent', () => {
    expect(projectWorkItemQuerySchema.parse({}).types).toBeUndefined();
  });

  it('refuses a type it does not know', () => {
    expect(projectWorkItemQuerySchema.safeParse({ types: 'task,epic' }).success).toBe(false);
  });

  it('caps the page size rather than letting a caller ask for everything', () => {
    expect(projectWorkItemQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(projectWorkItemQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('reads the view settings from JSON in the query string', () => {
    const parsed = projectWorkItemQuerySchema.parse({
      filters: JSON.stringify([{ field: 'assigneeId', operator: 'IN', value: [uuid] }]),
      sorts: JSON.stringify([{ field: 'dueDate', direction: 'DESC' }]),
      groupBy: 'status',
    });

    expect(parsed.filters).toEqual([{ field: 'assigneeId', operator: 'IN', value: [uuid] }]);
    expect(parsed.sorts).toEqual([{ field: 'dueDate', direction: 'DESC' }]);
    expect(parsed.groupBy).toBe('status');
  });

  it('reads showCompleted=false as false, which coercion would have read as true', () => {
    expect(projectWorkItemQuerySchema.parse({ showCompleted: 'false' }).showCompleted).toBe(false);
    expect(projectWorkItemQuerySchema.parse({ showCompleted: 'true' }).showCompleted).toBe(true);
    expect(projectWorkItemQuerySchema.parse({}).showCompleted).toBeUndefined();
    expect(projectWorkItemQuerySchema.safeParse({ showCompleted: 'yes' }).success).toBe(false);
  });

  it('reports malformed JSON as an issue on the parameter rather than throwing', () => {
    const result = projectWorkItemQuerySchema.safeParse({ filters: '{not json' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['filters']);
  });

  it('holds the settings to the same shape a saved view is held to', () => {
    // An operator that takes no value, given one, is the same mistake here as
    // it is on PATCH …/views/:id — and refused the same way.
    expect(
      projectWorkItemQuerySchema.safeParse({
        filters: JSON.stringify([{ field: 'dueDate', operator: 'IS_EMPTY', value: 'x' }]),
      }).success,
    ).toBe(false);
    expect(
      projectWorkItemQuerySchema.safeParse({
        sorts: JSON.stringify(Array.from({ length: 6 }, () => ({ field: 'title' }))),
      }).success,
    ).toBe(false);
  });
});

describe('bulkWorkItemSchema', () => {
  it('takes custom field values keyed by field id, in the value shape the field route takes', () => {
    const parsed = bulkWorkItemSchema.parse({
      workItemIds: [uuid],
      update: { customFieldValues: { [fieldId]: { optionIds: [uuid] } } },
    });

    expect(parsed.update?.customFieldValues).toEqual({ [fieldId]: { optionIds: [uuid] } });
  });

  it('counts a field value as a change, so a request carrying only one is not empty', () => {
    expect(
      bulkWorkItemSchema.safeParse({
        workItemIds: [uuid],
        update: { customFieldValues: { [fieldId]: { number: 3 } } },
      }).success,
    ).toBe(true);
  });

  it('refuses a value shape the field route would not take', () => {
    // The same strictness as `PUT …/custom-fields/:id`: an unknown key is a
    // typo, not a value.
    expect(
      bulkWorkItemSchema.safeParse({
        workItemIds: [uuid],
        update: { customFieldValues: { [fieldId]: { textValue: 'wrong key' } } },
      }).success,
    ).toBe(false);

    expect(
      bulkWorkItemSchema.safeParse({
        workItemIds: [uuid],
        update: { customFieldValues: { 'not-a-uuid': { number: 3 } } },
      }).success,
    ).toBe(false);
  });

  it('caps how many fields one request sets', () => {
    const many = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `019fc8d5-5365-76b1-b8bd-9659933${String(index).padStart(4, '0')}`,
        { number: index },
      ]),
    );

    expect(
      bulkWorkItemSchema.safeParse({ workItemIds: [uuid], update: { customFieldValues: many } })
        .success,
    ).toBe(false);
  });
});

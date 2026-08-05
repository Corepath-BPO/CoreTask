import { WorkItemType } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import {
  createWorkItemSchema,
  moveWorkItemSchema,
  projectWorkItemQuerySchema,
  updateWorkItemSchema,
} from './work-item.js';

const uuid = '019fc8d5-5365-76b1-b8bd-96599339f7ae';

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
});

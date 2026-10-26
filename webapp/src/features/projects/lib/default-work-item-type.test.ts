import {
  CREATABLE_WORK_ITEM_TYPES,
  WORK_ITEM_TYPES,
  WORK_ITEM_TYPE_ACTION_LABEL,
  WORK_ITEM_TYPE_LABEL,
  isCreatableWorkItemType,
} from '@coretask/contracts';
import { defaultWorkItemTypeSchema } from '@coretask/validation';
import { describe, expect, it } from 'vitest';

/**
 * The rule the split button and the project settings both depend on.
 *
 * A project's default has to be a type that can actually be created. Get this
 * wrong and the main button reads "+ Add milestone" and fails on click — the
 * fake-type failure the whole upgrade is meant to avoid — so it is pinned here
 * rather than left to the two places that happen to agree today.
 */
describe('what a project may default to', () => {
  it('offers only the types that can be created', () => {
    expect([...CREATABLE_WORK_ITEM_TYPES]).toEqual(['TASK', 'TICKET']);
  });

  it('declares more types than it can create, on purpose', () => {
    // Milestone and Approval exist so the picker can show them as coming.
    // Removing them would make "not built yet" indistinguishable from "never
    // considered", and adding them later would change the union.
    expect(WORK_ITEM_TYPES.length).toBeGreaterThan(CREATABLE_WORK_ITEM_TYPES.length);
    expect(WORK_ITEM_TYPES).toContain('MILESTONE');
    expect(isCreatableWorkItemType('MILESTONE')).toBe(false);
  });

  it('validates a project default against the creatable set, not the declared one', () => {
    for (const type of CREATABLE_WORK_ITEM_TYPES) {
      expect(defaultWorkItemTypeSchema.safeParse(type).success).toBe(true);
    }

    for (const type of ['MILESTONE', 'APPROVAL', 'EPIC']) {
      expect(defaultWorkItemTypeSchema.safeParse(type).success).toBe(false);
    }
  });

  it('has a label and an action label for every declared type', () => {
    // The menu shows a label for types it cannot create, so a gap here renders
    // an empty row rather than "Milestone — coming soon".
    for (const type of WORK_ITEM_TYPES) {
      expect(WORK_ITEM_TYPE_LABEL[type]).toBeTruthy();
      expect(WORK_ITEM_TYPE_ACTION_LABEL[type]).toMatch(/^Add /);
    }
  });
});

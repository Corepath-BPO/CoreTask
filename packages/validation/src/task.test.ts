import { describe, expect, it } from 'vitest';

import { createTaskSchema, updateTaskSchema } from './task';

describe('task schedule validation', () => {
  it('accepts a date with a time beside it', () => {
    const result = updateTaskSchema.safeParse({
      dueDate: '2026-09-05T00:00:00.000Z',
      dueAt: '2026-09-05T20:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a time on its own — the server checks there is a date to hang it on', () => {
    expect(updateTaskSchema.safeParse({ dueAt: '2026-09-05T20:00:00.000Z' }).success).toBe(true);
  });

  it('refuses a time sent while the date is being cleared', () => {
    const result = updateTaskSchema.safeParse({
      dueDate: null,
      dueAt: '2026-09-05T20:00:00.000Z',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['dueAt']);
  });

  it('applies the same rule to the start pair, at creation too', () => {
    expect(
      createTaskSchema.safeParse({
        title: 'Plan',
        startDate: null,
        startAt: '2026-09-01T14:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('clears a time with an empty string, like every other date field', () => {
    expect(updateTaskSchema.parse({ dueAt: '' }).dueAt).toBeNull();
  });
});

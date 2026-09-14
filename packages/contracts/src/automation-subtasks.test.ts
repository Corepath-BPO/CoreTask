import { describe, expect, it } from 'vitest';

import {
  MAX_SUBTASKS_PER_ACTION,
  isCalendarDate,
  subtaskEntries,
  subtaskEntry,
  subtaskProblems,
  subtaskTitles,
} from './automation';

/**
 * One reading of the list, shared by the runner, the validator and the builder.
 * These pin the shapes it must keep accepting — above all the single `title`
 * every rule built before the list existed still stores.
 */
describe('subtaskTitles', () => {
  it('reads the list in order, trimmed, with blank rows dropped', () => {
    expect(subtaskTitles({ subtasks: ['  First ', '', 'Second', '   '] })).toEqual([
      'First',
      'Second',
    ]);
  });

  it('still reads the single title older rules stored', () => {
    expect(subtaskTitles({ title: 'Only one' })).toEqual(['Only one']);
  });

  it('prefers the list over a stale single title', () => {
    // An empty list is an answer — "none yet" — not a reason to fall back.
    expect(subtaskTitles({ subtasks: [], title: 'Stale' })).toEqual([]);
  });

  it('reads nothing from a step never configured', () => {
    expect(subtaskTitles({})).toEqual([]);
  });

  it('caps the list at the per-action limit', () => {
    const many = Array.from({ length: MAX_SUBTASKS_PER_ACTION + 5 }, (_, i) => `Subtask ${i}`);

    expect(subtaskTitles({ subtasks: many })).toHaveLength(MAX_SUBTASKS_PER_ACTION);
  });

  it('stringifies whatever a hand-written configuration put in the list', () => {
    expect(subtaskTitles({ subtasks: [42, null, 'Real'] })).toEqual(['42', 'Real']);
  });
});

describe('subtaskEntries', () => {
  it('reads a bare string as a title with nobody and no date', () => {
    expect(subtaskEntries({ subtasks: ['Review'] })).toEqual([{ title: 'Review' }]);
  });

  it('carries the assignee and the due date a row names', () => {
    expect(
      subtaskEntries({
        subtasks: [
          { title: 'Review', assigneeId: 'u-1', dueInDays: 3 },
          { title: 'Sign off', dueDate: '2030-01-15' },
        ],
      }),
    ).toEqual([
      { title: 'Review', assigneeId: 'u-1', dueInDays: 3 },
      { title: 'Sign off', dueDate: '2030-01-15' },
    ]);
  });

  it('keeps the fixed date when a row holds both shapes', () => {
    expect(subtaskEntry({ title: 'Both', dueDate: '2030-01-15', dueInDays: 2 })).toEqual({
      title: 'Both',
      dueDate: '2030-01-15',
    });
  });

  it('drops a value of the wrong type rather than looking it up', () => {
    expect(subtaskEntry({ title: 'Odd', assigneeId: 7, dueInDays: '3' })).toEqual({ title: 'Odd' });
    expect(subtaskEntry({ title: 'Blank', assigneeId: '' })).toEqual({ title: 'Blank' });
  });

  it('keeps a blank title and an empty date on a row still being filled in', () => {
    // The form's reading: the row exists while somebody types into it.
    expect(subtaskEntry({ title: '', dueDate: '' })).toEqual({ title: '', dueDate: '' });
  });

  it('trims titles and drops blank rows, whatever else they carry', () => {
    expect(
      subtaskEntries({ subtasks: [{ title: '  ', assigneeId: 'u-1' }, { title: ' Real ' }] }),
    ).toEqual([{ title: 'Real' }]);
  });
});

describe('isCalendarDate', () => {
  it('accepts a real day written YYYY-MM-DD', () => {
    expect(isCalendarDate('2030-01-15')).toBe(true);
  });

  it('refuses other spellings, moments, and days that do not exist', () => {
    expect(isCalendarDate('15/01/2030')).toBe(false);
    expect(isCalendarDate('2030-02-30')).toBe(false);
    expect(isCalendarDate('2030-01-15T10:00:00Z')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
    expect(isCalendarDate(20300115)).toBe(false);
  });
});

describe('subtaskProblems', () => {
  it('finds nothing wrong with rows that name nothing, or name it properly', () => {
    expect(
      subtaskProblems({
        subtasks: [
          'Bare',
          { title: 'Dated', dueDate: '2030-01-15' },
          { title: 'Now', dueInDays: 0 },
        ],
      }),
    ).toEqual([]);
  });

  it('reads an empty date as unfinished and a wrong one as wrong', () => {
    expect(subtaskProblems({ subtasks: [{ title: 'A', dueDate: '' }] })).toEqual([
      { message: expect.stringContaining('Choose a due date'), incomplete: true },
    ]);
    expect(subtaskProblems({ subtasks: [{ title: 'A', dueDate: 'next Tuesday' }] })).toEqual([
      { message: expect.stringContaining('not a real date'), incomplete: false },
    ]);
  });

  it('refuses days that are negative or not whole', () => {
    expect(
      subtaskProblems({
        subtasks: [
          { title: 'A', dueInDays: -1 },
          { title: 'B', dueInDays: 1.5 },
        ],
      }),
    ).toEqual([{ message: expect.stringContaining('whole number'), incomplete: false }]);
  });

  it('says each thing once, however many rows share it', () => {
    expect(
      subtaskProblems({
        subtasks: [
          { title: 'A', dueDate: '' },
          { title: 'B', dueDate: '' },
        ],
      }),
    ).toHaveLength(1);
  });

  it('ignores a blank row, which is dropped before it could be created', () => {
    expect(subtaskProblems({ subtasks: [{ title: '', dueDate: 'garbage' }] })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { buildImportPlan } from './asana-import';
import type { ParsedCsv } from './parse-csv';

const HEADERS = [
  'Task ID',
  'Created At',
  'Completed At',
  'Last Modified',
  'Name',
  'Section/Column',
  'Assignee',
  'Assignee Email',
  'Start Date',
  'Due Date',
  'Tags',
  'Notes',
  'Projects',
  'Parent task',
  'Blocked By (Dependencies)',
  'Blocking (Dependencies)',
];

/** Builds a padded row from named cells, in header order. */
function row(cells: Partial<Record<string, string>>, headers = HEADERS): string[] {
  return headers.map((header) => cells[header] ?? '');
}

function csv(rows: string[][], headers = HEADERS): ParsedCsv {
  return { headers, rows };
}

const NO_MEMBERS = new Map<string, string>();

function plan(rows: string[][], headers = HEADERS, membersByEmail = NO_MEMBERS) {
  return buildImportPlan(csv(rows, headers), { membersByEmail, fileName: 'export.csv' });
}

describe('buildImportPlan', () => {
  it('splits top-level tasks and subtasks and keeps section order', () => {
    const result = plan([
      row({ Name: 'Parent A', 'Section/Column': 'Doing', Projects: 'My Proj' }),
      row({ Name: 'Child 1', 'Parent task': 'Parent A' }),
      row({ Name: 'Parent B', 'Section/Column': 'Done' }),
      row({ Name: 'Parent C', 'Section/Column': 'Doing' }),
    ]);

    expect(result.projectName).toBe('My Proj');
    expect(result.sections).toEqual(['Doing', 'Done']);
    expect(result.stats).toMatchObject({ topLevel: 3, subtasks: 1 });
    expect(result.tasks[1]).toMatchObject({ parentIndex: 0, sectionIndex: null });
    expect(result.tasks[3]).toMatchObject({ parentIndex: null, sectionIndex: 0 });
  });

  it('survives reordered columns because classification is by header name', () => {
    const shuffled = [...HEADERS].reverse();
    const result = plan(
      [row({ Name: 'Only task', 'Section/Column': 'Inbox' }, shuffled)],
      shuffled,
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.sections).toEqual(['Inbox']);
  });

  it('resolves a duplicated parent name to the most recently seen task', () => {
    const result = plan([
      row({ Name: 'Build it', 'Section/Column': 'A' }),
      row({ Name: 'step', 'Parent task': 'Build it' }),
      row({ Name: 'Build it', 'Section/Column': 'B' }),
      row({ Name: 'later step', 'Parent task': 'Build it' }),
    ]);

    expect(result.tasks[1]?.parentIndex).toBe(0);
    expect(result.tasks[3]?.parentIndex).toBe(2);
  });

  it('flattens a grandchild onto its top-level ancestor', () => {
    const result = plan([
      row({ Name: 'Top', 'Section/Column': 'A' }),
      row({ Name: 'Mid', 'Parent task': 'Top' }),
      row({ Name: 'Deep', 'Parent task': 'Mid' }),
    ]);

    expect(result.tasks[2]?.parentIndex).toBe(0);
    expect(result.stats.flattened).toBe(1);
  });

  it('promotes an orphan whose parent never appeared, with a warning', () => {
    const result = plan([
      row({ Name: 'Real', 'Section/Column': 'A' }),
      row({ Name: 'Lost child', 'Parent task': 'Ghost' }),
    ]);

    expect(result.tasks[1]).toMatchObject({ parentIndex: null, sectionIndex: 0 });
    expect(result.stats.orphaned).toBe(1);
    expect(result.warnings.some((w) => w.message.includes('Ghost'))).toBe(true);
  });

  it('skips empty-name rows and routes their children through the orphan path', () => {
    const result = plan([
      row({ Name: 'Anchor', 'Section/Column': 'A' }),
      row({ Name: '', 'Section/Column': 'A' }),
      row({ Name: 'child of nothing', 'Parent task': '' }),
    ]);

    expect(result.stats.skippedEmptyName).toBe(1);
    // The child had an empty parent cell, so it is simply top-level.
    expect(result.tasks).toHaveLength(2);
  });

  it('gives unsectioned top-level tasks a "(No section)" bucket at the end', () => {
    const result = plan([
      row({ Name: 'Sectioned', 'Section/Column': 'Alpha' }),
      row({ Name: 'Floating' }),
    ]);

    expect(result.sections).toEqual(['Alpha', '(No section)']);
    expect(result.tasks[1]?.sectionIndex).toBe(1);
  });

  it('blocks a plan with more than 50 sections', () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      row({ Name: `t${i}`, 'Section/Column': `s${i}` }),
    );
    expect(plan(rows).blockingError).toMatch(/51 sections/);
  });

  it('converts plain dates to midnight UTC and passes ISO through', () => {
    const result = plan([
      row({ Name: 'a', 'Section/Column': 's', 'Due Date': '2026-08-21' }),
      row({ Name: 'b', 'Section/Column': 's', 'Start Date': '2026-05-29T13:51:00.000Z' }),
      row({ Name: 'c', 'Section/Column': 's', 'Due Date': 'not a date' }),
    ]);

    expect(result.tasks[0]?.dueDate).toBe('2026-08-21T00:00:00.000Z');
    expect(result.tasks[1]?.startDate).toBe('2026-05-29T13:51:00.000Z');
    expect(result.tasks[2]?.dueDate).toBeNull();
    expect(result.warnings.some((w) => w.message.includes('not a date'))).toBe(true);
  });

  it('marks tasks done when Completed At is set', () => {
    const result = plan([
      row({ Name: 'done one', 'Section/Column': 's', 'Completed At': '2026-07-08' }),
      row({ Name: 'open one', 'Section/Column': 's' }),
    ]);
    expect(result.tasks[0]?.done).toBe(true);
    expect(result.tasks[1]?.done).toBe(false);
  });

  it('consumes Priority as system priority when every value maps', () => {
    const headers = [...HEADERS, 'Priority'];
    const result = plan(
      [
        row({ Name: 'a', 'Section/Column': 's', Priority: 'High' }, headers),
        row({ Name: 'b', 'Section/Column': 's', Priority: 'critical' }, headers),
      ],
      headers,
    );

    expect(result.tasks.map((t) => t.priority)).toEqual(['HIGH', 'CRITICAL']);
    expect(result.customFieldColumns).toHaveLength(0);
  });

  it('keeps Priority as a custom column when a value does not map', () => {
    const headers = [...HEADERS, 'Priority'];
    const result = plan(
      [
        row({ Name: 'a', 'Section/Column': 's', Priority: 'High' }, headers),
        row({ Name: 'b', 'Section/Column': 's', Priority: 'Urgent-ish' }, headers),
      ],
      headers,
    );

    expect(result.tasks.every((t) => t.priority === null)).toBe(true);
    expect(result.customFieldColumns.map((c) => c.header)).toEqual(['Priority']);
  });

  it('matches assignee emails case-insensitively and lists the unmatched', () => {
    const members = new Map([['it@texasrenters.com', 'user-1']]);
    const result = buildImportPlan(
      csv([
        row({ Name: 'a', 'Section/Column': 's', 'Assignee Email': 'IT@TexasRenters.com' }),
        row({ Name: 'b', 'Section/Column': 's', 'Assignee Email': 'ghost@nowhere.com' }),
      ]),
      { membersByEmail: members, fileName: 'x.csv' },
    );

    expect(result.tasks[0]?.assigneeUserId).toBe('user-1');
    expect(result.tasks[1]?.assigneeUserId).toBeNull();
    expect(result.stats).toMatchObject({ assigneesMatched: 1, assigneesUnmatched: 1 });
    expect(result.stats.unmatchedEmails).toEqual(['ghost@nowhere.com']);
  });

  describe('custom column type detection', () => {
    function withColumn(values: string[]) {
      const headers = [...HEADERS, 'Extra'];
      const rows = values.map((value, i) =>
        row({ Name: `t${i}`, 'Section/Column': 's', Extra: value }, headers),
      );
      return plan(rows, headers).customFieldColumns[0];
    }

    it('detects all-date columns as DATE and converts the values', () => {
      const headers = [...HEADERS, 'Extra'];
      const result = plan(
        [row({ Name: 't', 'Section/Column': 's', Extra: '2026-07-08' }, headers)],
        headers,
      );
      expect(result.customFieldColumns[0]?.type).toBe('DATE');
      expect(result.tasks[0]?.customValues[0]).toBe('2026-07-08T00:00:00.000Z');
    });

    it('detects strictly numeric columns as NUMBER', () => {
      expect(withColumn(['1', '2.5', '-3'])?.type).toBe('NUMBER');
    });

    it('never misreads locale-formatted numbers as NUMBER', () => {
      // '1,200' must not become the number 1. A select or text keeps it whole.
      expect(withColumn(['1,200', '3'])?.type).not.toBe('NUMBER');
    });

    it('detects small label sets as SINGLE_SELECT with ordered options', () => {
      const column = withColumn(['Bug', 'Feature', 'Bug', 'Chore']);
      expect(column?.type).toBe('SINGLE_SELECT');
      expect(column?.options).toEqual(['Bug', 'Feature', 'Chore']);
    });

    it('falls back to TEXT past 20 distinct values', () => {
      const values = Array.from({ length: 21 }, (_, i) => `label ${i}`);
      expect(withColumn(values)?.type).toBe('TEXT');
    });

    it('falls back to TEXT when a label exceeds the 80-character option cap', () => {
      expect(withColumn(['ok', 'x'.repeat(81)])?.type).toBe('TEXT');
    });

    it('drops columns with no values at all', () => {
      const headers = [...HEADERS, 'Extra'];
      const result = plan([row({ Name: 't', 'Section/Column': 's' }, headers)], headers);
      expect(result.customFieldColumns).toHaveLength(0);
    });
  });

  it('truncates over-long titles and descriptions with warnings', () => {
    const result = plan([
      row({ Name: 'x'.repeat(600), 'Section/Column': 's', Notes: 'y'.repeat(20_100) }),
    ]);

    expect(result.tasks[0]?.title).toHaveLength(500);
    expect(result.tasks[0]?.description).toHaveLength(20_000);
    expect(result.warnings).toHaveLength(2);
  });

  it('falls back to the file name when no Projects value exists', () => {
    const result = plan([row({ Name: 'a', 'Section/Column': 's' })]);
    expect(result.projectName).toBe('export');
  });

  it('warns once about ignored tags', () => {
    const result = plan([
      row({ Name: 'a', 'Section/Column': 's', Tags: 'TR, CorePath' }),
      row({ Name: 'b', 'Section/Column': 's', Tags: 'n8n' }),
    ]);
    const tagWarnings = result.warnings.filter((w) => w.message.includes('Tags'));
    expect(tagWarnings).toHaveLength(1);
    expect(tagWarnings[0]?.message).toContain('2 rows');
  });
});

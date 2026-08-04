import { CustomFieldType, FilterOperator } from '@coretask/contracts';

import { AppException } from '../../src/common/exceptions/app.exception';
import {
  compileFilters,
  compileSorts,
  type CustomFieldMap,
} from '../../src/modules/project-views/lib/query-compiler';

/**
 * The compiler is the boundary between a client-supplied query and the
 * database. Everything it accepts becomes a Prisma call; everything it rejects
 * never reaches one. These tests are as much about what it refuses as what it
 * builds.
 */
describe('query compiler', () => {
  const fields: CustomFieldMap = new Map([
    ['11111111-1111-4111-8111-111111111111', {
      id: '11111111-1111-4111-8111-111111111111',
      type: CustomFieldType.TEXT,
    }],
    ['22222222-2222-4222-8222-222222222222', {
      id: '22222222-2222-4222-8222-222222222222',
      type: CustomFieldType.SINGLE_SELECT,
    }],
    ['33333333-3333-4333-8333-333333333333', {
      id: '33333333-3333-4333-8333-333333333333',
      type: CustomFieldType.NUMBER,
    }],
  ]);

  const compile = (field: string, operator: FilterOperator, value?: unknown) =>
    compileFilters([{ field, operator, value: value as never }], fields)[0];

  describe('refusing what it does not recognise', () => {
    it('rejects a field that is not a system field', () => {
      expect(() => compile('passwordHash', FilterOperator.EQUALS, 'x')).toThrow(AppException);
    });

    it('rejects a custom field that belongs to another project', () => {
      expect(() =>
        compile('custom:99999999-9999-4999-8999-999999999999', FilterOperator.EQUALS, 'x'),
      ).toThrow(AppException);
    });

    /*
     * The reason field names are resolved against a closed set rather than
     * passed through: anything else is an injection surface the moment someone
     * builds a raw query on top of it.
     */
    it.each([
      'id',
      'workspaceId',
      "title'; DROP TABLE tasks;--",
      '../../etc',
      '__proto__',
      'customFieldValues',
    ])('rejects "%s"', (field) => {
      expect(() => compile(field, FilterOperator.EQUALS, 'x')).toThrow(AppException);
    });
  });

  describe('system fields', () => {
    it('compiles equality', () => {
      expect(compile('status', FilterOperator.EQUALS, 'DONE')).toEqual({ status: 'DONE' });
    });

    it('compiles a list', () => {
      expect(compile('priority', FilterOperator.IN, ['HIGH', 'CRITICAL'])).toEqual({
        priority: { in: ['HIGH', 'CRITICAL'] },
      });
    });

    it('searches text case-insensitively', () => {
      expect(compile('title', FilterOperator.CONTAINS, 'Login')).toEqual({
        title: { contains: 'Login', mode: 'insensitive' },
      });
    });

    it('turns a date string into a Date', () => {
      const result = compile('dueDate', FilterOperator.BEFORE, '2026-08-04T00:00:00.000Z') as {
        dueDate: { lt: Date };
      };

      expect(result.dueDate.lt).toBeInstanceOf(Date);
      expect(result.dueDate.lt.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    });

    it('rejects a date that is not a date', () => {
      expect(() => compile('dueDate', FilterOperator.BEFORE, 'last tuesday')).toThrow(AppException);
    });

    it('rejects a number that is not a number', () => {
      expect(() => compile('estimatedMinutes', FilterOperator.GREATER_THAN, 'lots')).toThrow(
        AppException,
      );
    });

    it('compiles unset', () => {
      expect(compile('assigneeId', FilterOperator.IS_EMPTY)).toEqual({ assigneeId: null });
      expect(compile('assigneeId', FilterOperator.IS_NOT_EMPTY)).toEqual({
        assigneeId: { not: null },
      });
    });
  });

  describe('custom fields', () => {
    const TEXT = 'custom:11111111-1111-4111-8111-111111111111';
    const SELECT = 'custom:22222222-2222-4222-8222-222222222222';
    const NUMBER = 'custom:33333333-3333-4333-8333-333333333333';

    it('routes each type to its own storage column', () => {
      expect(compile(TEXT, FilterOperator.EQUALS, 'Support')).toMatchObject({
        customFieldValues: { some: { textValue: 'Support' } },
      });
      expect(compile(NUMBER, FilterOperator.GREATER_THAN, 5)).toMatchObject({
        customFieldValues: { some: { numberValue: { gt: 5 } } },
      });
    });

    it('matches select options by membership', () => {
      expect(compile(SELECT, FilterOperator.IN, ['opt-a', 'opt-b'])).toMatchObject({
        customFieldValues: { some: { optionIds: { hasSome: ['opt-a', 'opt-b'] } } },
      });
    });

    /*
     * The bug this prevents: `every` over an empty relation is vacuously true,
     * so a task with no value at all would match "Department equals Support".
     * `some` is what makes an unset task not match.
     */
    it('uses some, never every, so unset tasks do not match', () => {
      const result = JSON.stringify(compile(TEXT, FilterOperator.EQUALS, 'Support'));

      expect(result).toContain('some');
      expect(result).not.toContain('every');
    });

    /*
     * "Unset" has two shapes — no row at all, or a row whose column is null —
     * and a task can be in either depending on whether a value was ever set and
     * then cleared. Missing one leaves tasks the user expects to see.
     */
    it('treats a missing row and a null value as equally empty', () => {
      const result = compile(TEXT, FilterOperator.IS_EMPTY) as { OR: unknown[] };

      expect(result.OR).toHaveLength(2);
      expect(JSON.stringify(result)).toContain('none');
      expect(JSON.stringify(result)).toContain('some');
    });
  });

  describe('sorting', () => {
    it('keeps the requested order', () => {
      expect(compileSorts([{ field: 'priority', direction: 'DESC' }])[0]).toEqual({
        priority: 'desc',
      });
    });

    /*
     * Without a unique tail, two rows with the same sort value can come back in
     * a different order on each request — so paging repeats one and skips
     * another. It is invisible until a user pages through a list.
     */
    it('always ends deterministically', () => {
      const result = compileSorts([{ field: 'dueDate', direction: 'ASC' }]);

      expect(result.at(-1)).toEqual({ id: 'asc' });
      expect(result.at(-2)).toEqual({ position: 'asc' });
    });

    it('is deterministic even with no sorts at all', () => {
      expect(compileSorts([])).toEqual([{ position: 'asc' }, { id: 'asc' }]);
    });

    it('drops an unknown field rather than passing it through', () => {
      expect(compileSorts([{ field: 'passwordHash', direction: 'ASC' }])).toEqual([
        { position: 'asc' },
        { id: 'asc' },
      ]);
    });
  });

  it('combines several conditions into one clause per condition', () => {
    const result = compileFilters(
      [
        { field: 'status', operator: FilterOperator.EQUALS, value: 'TODO' },
        { field: 'priority', operator: FilterOperator.IN, value: ['HIGH'] },
      ],
      fields,
    );

    expect(result).toHaveLength(2);
  });
});

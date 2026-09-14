import { CustomFieldType } from '@coretask/contracts';
import { Prisma } from '@prisma/client';

import { AppException } from '../../src/common/exceptions/app.exception';
import { compileOrder } from '../../src/modules/project-views/lib/order-compiler';
import type { CustomFieldMap } from '../../src/modules/project-views/lib/query-compiler';

/**
 * The order compiler is the one place user input meets raw SQL. These pin
 * down what it emits per kind of key, that nothing from a request lands in
 * the text of the query, and that the identifiers it uses are the tables'
 * real names — a rename in the schema fails here rather than at runtime.
 */
describe('order compiler', () => {
  const NUMBER_ID = '11111111-1111-4111-8111-111111111111';
  const SELECT_ID = '22222222-2222-4222-8222-222222222222';
  const PEOPLE_ID = '33333333-3333-4333-8333-333333333333';
  const FORMULA_ID = '44444444-4444-4444-8444-444444444444';

  const fields: CustomFieldMap = new Map([
    [NUMBER_ID, { id: NUMBER_ID, type: CustomFieldType.NUMBER }],
    [SELECT_ID, { id: SELECT_ID, type: CustomFieldType.SINGLE_SELECT }],
    [PEOPLE_ID, { id: PEOPLE_ID, type: CustomFieldType.PEOPLE }],
    [FORMULA_ID, { id: FORMULA_ID, type: CustomFieldType.FORMULA }],
  ]);

  const text = (sql: Prisma.Sql) => sql.sql;
  const values = (sql: Prisma.Sql) => sql.values;

  it('orders a system date by its column on both kinds', () => {
    const plan = compileOrder([{ field: 'dueDate', direction: 'ASC' }], null, fields);

    expect(plan.keys).toHaveLength(1);
    expect(text(plan.keys[0]!.task)).toContain('t."dueDate"');
    expect(text(plan.keys[0]!.ticket)).toContain('k."dueDate"');
    expect(plan.taskJoins).toEqual([]);
  });

  it('maps completion onto a ticket’s resolution, and a start date onto nothing', () => {
    const plan = compileOrder(
      [
        { field: 'completedAt', direction: 'DESC' },
        { field: 'startDate', direction: 'ASC' },
      ],
      null,
      fields,
    );

    expect(text(plan.keys[0]!.ticket)).toContain('k."resolvedAt"');
    expect(text(plan.keys[1]!.ticket)).toContain('NULL::timestamp');
  });

  it('orders a status by its definition’s position, with the enum as the fallback', () => {
    const plan = compileOrder([{ field: 'status', direction: 'ASC' }], null, fields);

    expect(text(plan.keys[0]!.task)).toContain('COALESCE(sd.position');
    expect(text(plan.taskJoins[0]!)).toContain('LEFT JOIN status_definitions sd');
    // The enum names are bound values, never text in the query.
    expect(values(plan.keys[0]!.task)).toContain('BACKLOG');
    expect(values(plan.keys[0]!.ticket)).toContain('OPEN');
  });

  it('orders people by name, joining the users table once per key', () => {
    const plan = compileOrder(
      [
        { field: 'assigneeId', direction: 'ASC' },
        { field: 'createdById', direction: 'ASC' },
      ],
      null,
      fields,
    );

    expect(text(plan.keys[0]!.task)).toBe('lower(ta.name)');
    expect(text(plan.keys[1]!.ticket)).toBe('lower(kc.name)');
    expect(plan.taskJoins.map(text)).toEqual([
      'LEFT JOIN users ta ON ta.id = t."assigneeId"',
      'LEFT JOIN users tc ON tc.id = t."createdById"',
    ]);
    expect(plan.ticketJoins.map(text)[1]).toBe('LEFT JOIN users kc ON kc.id = k."reporterId"');
  });

  it('joins the value table for a custom number, binding the field id', () => {
    const plan = compileOrder([{ field: `custom:${NUMBER_ID}`, direction: 'DESC' }], null, fields);

    expect(text(plan.keys[0]!.task)).toBe('v0."numberValue"::double precision');
    expect(text(plan.keys[0]!.ticket)).toBe('NULL::double precision');
    expect(text(plan.taskJoins[0]!)).toBe(
      'LEFT JOIN task_custom_field_values v0 ON v0."taskId" = t.id AND v0."customFieldId" = ?::uuid',
    );
    expect(values(plan.taskJoins[0]!)).toEqual([NUMBER_ID]);
    // The uuid never appears in the SQL text itself.
    expect(text(plan.taskJoins[0]!)).not.toContain(NUMBER_ID);
  });

  it('orders a select by the option’s position and people by the person’s name', () => {
    const plan = compileOrder(
      [
        { field: `custom:${SELECT_ID}`, direction: 'ASC' },
        { field: `custom:${PEOPLE_ID}`, direction: 'ASC' },
      ],
      null,
      fields,
    );

    expect(text(plan.keys[0]!.task)).toBe('o0.position::double precision');
    expect(text(plan.taskJoins[1]!)).toBe(
      'LEFT JOIN custom_field_options o0 ON o0.id = v0."optionIds"[1]',
    );
    expect(text(plan.keys[1]!.task)).toBe('lower(pu1.name)');
    expect(text(plan.taskJoins[3]!)).toBe('LEFT JOIN users pu1 ON pu1.id = v1."userIds"[1]');
  });

  it('puts the group key first, without repeating it', () => {
    const plan = compileOrder(
      [
        { field: 'dueDate', direction: 'DESC' },
        { field: 'status', direction: 'ASC' },
      ],
      'status',
      fields,
    );

    expect(plan.keys.map((key) => key.direction)).toEqual(['ASC', 'DESC']);
    expect(text(plan.keys[0]!.task)).toContain('sd.position');
    expect(text(plan.keys[1]!.task)).toContain('t."dueDate"');
  });

  it('refuses a field the project lacks, a formula, and a name it does not know', () => {
    const missing = '99999999-9999-4999-8999-999999999999';

    expect(() =>
      compileOrder([{ field: `custom:${missing}`, direction: 'ASC' }], null, fields),
    ).toThrow(AppException);
    expect(() =>
      compileOrder([{ field: `custom:${FORMULA_ID}`, direction: 'ASC' }], null, fields),
    ).toThrow(/calculated/i);
    expect(() => compileOrder([{ field: 'wibble', direction: 'ASC' }], null, fields)).toThrow(
      AppException,
    );
    expect(() => compileOrder([], 'custom:not-a-field', fields)).toThrow(AppException);
  });
});

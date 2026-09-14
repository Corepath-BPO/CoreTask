import {
  CUSTOM_FIELD_KIND,
  CustomFieldType,
  SystemField,
  isSystemField,
  parseCustomFieldRef,
  type SortDirection,
} from '@coretask/contracts';
import { Prisma } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';

import type { CustomFieldMap, SortEntry } from './query-compiler';

/**
 * One key of the ordering: the expression for a task row, the expression for
 * a ticket row, and which way it runs. The two expressions carry the same SQL
 * type, because the rows meet in a `UNION ALL`.
 */
export interface OrderKey {
  task: Prisma.Sql;
  ticket: Prisma.Sql;
  direction: SortDirection;
}

export interface OrderPlan {
  keys: OrderKey[];
  /** `LEFT JOIN … ON …` fragments the task keys need, each once. */
  taskJoins: Prisma.Sql[];
  ticketJoins: Prisma.Sql[];
}

/**
 * Turns a view's sorts (and its group key) into the pieces of one SQL ordering.
 *
 * Identifiers come only from the const tables below through `Prisma.raw`;
 * every user value — a field id — is bound. A sort naming a field this project
 * does not have, or one the compiler cannot order by, is refused with a 400
 * rather than passed through, which is what keeps `?sorts=` from becoming an
 * injection surface.
 *
 * Tasks and tickets are ordered in one query so a due-date sort interleaves
 * them by date; for a custom field, which tickets do not hold, every ticket's
 * key is `NULL` and lands after the valued tasks in both directions.
 */
export function compileOrder(
  sorts: readonly SortEntry[],
  groupBy: string | null,
  customFields: CustomFieldMap,
): OrderPlan {
  // The group key leads, so a page never splits a group in two.
  const entries: SortEntry[] = groupBy
    ? [{ field: groupBy, direction: 'ASC' }, ...sorts.filter((sort) => sort.field !== groupBy)]
    : [...sorts];

  const plan: OrderPlan = { keys: [], taskJoins: [], ticketJoins: [] };
  const joined = new Set<string>();

  const join = (side: 'task' | 'ticket', name: string, fragment: Prisma.Sql) => {
    const id = `${side}:${name}`;
    if (joined.has(id)) return;
    joined.add(id);
    (side === 'task' ? plan.taskJoins : plan.ticketJoins).push(fragment);
  };

  entries.forEach((entry, index) => {
    const customFieldId = parseCustomFieldRef(entry.field);

    if (customFieldId) {
      const field = customFields.get(customFieldId);
      if (!field) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          'That sort refers to a field this project does not have.',
        );
      }
      plan.keys.push({ ...customFieldKey(field, index, join), direction: entry.direction });
      return;
    }

    if (!isSystemField(entry.field)) {
      throw AppException.badRequest('BAD_REQUEST', `Cannot sort by "${entry.field}".`);
    }

    plan.keys.push({ ...systemKey(entry.field, join), direction: entry.direction });
  });

  return plan;
}

type Joiner = (side: 'task' | 'ticket', name: string, fragment: Prisma.Sql) => void;

/*
 * The enum vocabularies, in the order the UI lists them, for a task with no
 * definition and for every ticket. A definition's `position` wins when there
 * is one; the two are on the same scale only loosely, which is acceptable
 * because a project mixes them only while its backfill is verified.
 */
const TASK_STATUS_ORDER = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELLED',
];
const TASK_PRIORITY_ORDER = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const TICKET_STATUS_ORDER = ['OPEN', 'TRIAGED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'];
const TICKET_PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/** `CASE col WHEN 'A' THEN 0 WHEN 'B' THEN 1 … END::double precision`. */
function enumRank(column: Prisma.Sql, order: readonly string[]): Prisma.Sql {
  const arms = order.map((value, rank) => Prisma.sql`WHEN ${value} THEN ${rank}::double precision`);
  return Prisma.sql`(CASE ${column}::text ${Prisma.join(arms, ' ')} END)`;
}

const NULL_TEXT = Prisma.sql`NULL::text`;
const NULL_NUMBER = Prisma.sql`NULL::double precision`;
const NULL_DATE = Prisma.sql`NULL::timestamp`;

function systemKey(field: SystemField, join: Joiner): Omit<OrderKey, 'direction'> {
  switch (field) {
    case SystemField.TITLE:
      return { task: Prisma.sql`lower(t.title)`, ticket: Prisma.sql`lower(k.title)` };

    case SystemField.STATUS:
      join(
        'task',
        'sd',
        Prisma.sql`LEFT JOIN status_definitions sd ON sd.id = t."statusDefinitionId"`,
      );
      return {
        task: Prisma.sql`COALESCE(sd.position::double precision, ${enumRank(Prisma.sql`t.status`, TASK_STATUS_ORDER)})`,
        ticket: enumRank(Prisma.sql`k.status`, TICKET_STATUS_ORDER),
      };

    case SystemField.PRIORITY:
      join(
        'task',
        'pd',
        Prisma.sql`LEFT JOIN priority_definitions pd ON pd.id = t."priorityDefinitionId"`,
      );
      return {
        task: Prisma.sql`COALESCE(pd.position::double precision, ${enumRank(Prisma.sql`t.priority`, TASK_PRIORITY_ORDER)})`,
        ticket: enumRank(Prisma.sql`k.priority`, TICKET_PRIORITY_ORDER),
      };

    case SystemField.SECTION:
      join('task', 'ts', Prisma.sql`LEFT JOIN sections ts ON ts.id = t."sectionId"`);
      join('ticket', 'ks', Prisma.sql`LEFT JOIN sections ks ON ks.id = k."sectionId"`);
      return {
        task: Prisma.sql`ts.position::double precision`,
        ticket: Prisma.sql`ks.position::double precision`,
      };

    case SystemField.ASSIGNEE:
      join('task', 'ta', Prisma.sql`LEFT JOIN users ta ON ta.id = t."assigneeId"`);
      join('ticket', 'ka', Prisma.sql`LEFT JOIN users ka ON ka.id = k."assigneeId"`);
      return { task: Prisma.sql`lower(ta.name)`, ticket: Prisma.sql`lower(ka.name)` };

    case SystemField.CREATED_BY:
      join('task', 'tc', Prisma.sql`LEFT JOIN users tc ON tc.id = t."createdById"`);
      join('ticket', 'kc', Prisma.sql`LEFT JOIN users kc ON kc.id = k."reporterId"`);
      return { task: Prisma.sql`lower(tc.name)`, ticket: Prisma.sql`lower(kc.name)` };

    case SystemField.DUE_DATE:
      return { task: Prisma.sql`t."dueDate"`, ticket: Prisma.sql`k."dueDate"` };

    case SystemField.START_DATE:
      return { task: Prisma.sql`t."startDate"`, ticket: NULL_DATE };

    case SystemField.COMPLETED_AT:
      return { task: Prisma.sql`t."completedAt"`, ticket: Prisma.sql`k."resolvedAt"` };

    case SystemField.CREATED_AT:
      return { task: Prisma.sql`t."createdAt"`, ticket: Prisma.sql`k."createdAt"` };

    case SystemField.UPDATED_AT:
      return { task: Prisma.sql`t."updatedAt"`, ticket: Prisma.sql`k."updatedAt"` };

    case SystemField.ESTIMATE:
      return { task: Prisma.sql`t."estimatedMinutes"::double precision`, ticket: NULL_NUMBER };
  }
}

/**
 * A custom field's key: one join on the value table per key, plus one on the
 * options or users table for the types that store an id. Tickets hold no
 * values, so their side is a typed `NULL`.
 */
function customFieldKey(
  field: { id: string; type: CustomFieldType },
  index: number,
  join: Joiner,
): Omit<OrderKey, 'direction'> {
  const kind = CUSTOM_FIELD_KIND[field.type];
  if (kind === null) {
    throw AppException.badRequest('BAD_REQUEST', 'Calculated fields cannot be filtered or sorted.');
  }

  // Aliases are ours — an index we control, never anything from the request.
  const v = Prisma.raw(`v${index}`);
  join(
    'task',
    `v${index}`,
    Prisma.sql`LEFT JOIN task_custom_field_values ${v} ON ${v}."taskId" = t.id AND ${v}."customFieldId" = ${field.id}::uuid`,
  );

  switch (kind) {
    case 'TEXT':
      return { task: Prisma.sql`lower(${v}."textValue")`, ticket: NULL_TEXT };
    case 'NUMBER':
      return { task: Prisma.sql`${v}."numberValue"::double precision`, ticket: NULL_NUMBER };
    case 'DATE':
      return { task: Prisma.sql`${v}."dateValue"`, ticket: NULL_DATE };
    case 'BOOLEAN':
      return { task: Prisma.sql`${v}."booleanValue"`, ticket: Prisma.sql`NULL::boolean` };
    case 'ENUM': {
      // By the option's position, not its label: "Low, Medium, High" is the
      // order the field's author gave, and alphabetical would break it.
      const o = Prisma.raw(`o${index}`);
      join(
        'task',
        `o${index}`,
        Prisma.sql`LEFT JOIN custom_field_options ${o} ON ${o}.id = ${v}."optionIds"[1]`,
      );
      return { task: Prisma.sql`${o}.position::double precision`, ticket: NULL_NUMBER };
    }
    case 'PEOPLE': {
      const u = Prisma.raw(`pu${index}`);
      join('task', `pu${index}`, Prisma.sql`LEFT JOIN users ${u} ON ${u}.id = ${v}."userIds"[1]`);
      return { task: Prisma.sql`lower(${u}.name)`, ticket: NULL_TEXT };
    }
  }
}

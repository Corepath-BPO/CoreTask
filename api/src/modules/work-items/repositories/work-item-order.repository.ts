import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import type { OrderPlan } from '../../project-views/lib/order-compiler';

export interface OrderedId {
  id: string;
  kind: 'TASK' | 'TICKET';
}

/** Directions come from here and nowhere else. */
const DIRECTION = { ASC: Prisma.raw('ASC'), DESC: Prisma.raw('DESC') } as const;

/**
 * The one raw query in the work-item feature: which ids come first.
 *
 * Predicates stay in Prisma — the two repositories compute their allowlists of
 * ids with the same `where` they always used — and only the ordering goes to
 * SQL, over those ids. The SQL never sees a user value except bound field ids;
 * identifiers and directions come from const tables through `Prisma.raw`.
 *
 * `NULLS LAST` in both directions, so an empty cell sits at the bottom whether
 * the column is ascending or descending; then `position, id` as the tail, so
 * two equal keys never swap between reads.
 */
@Injectable()
export class WorkItemOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async orderIds(
    taskIds: readonly string[],
    ticketIds: readonly string[],
    plan: OrderPlan,
    take: number,
  ): Promise<OrderedId[]> {
    if (taskIds.length === 0 && ticketIds.length === 0) return [];

    const keyAlias = (index: number) => Prisma.raw(`k${index}`);
    const joins = (fragments: Prisma.Sql[]) =>
      fragments.length > 0 ? Prisma.join(fragments, ' ') : Prisma.empty;
    const idList = (ids: readonly string[]) =>
      Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));

    const taskPart =
      taskIds.length > 0
        ? Prisma.sql`SELECT t.id AS id, 'TASK'::text AS kind, ${Prisma.join(
            [
              ...plan.keys.map((key, index) => Prisma.sql`${key.task} AS ${keyAlias(index)}`),
              Prisma.sql`t.position::double precision AS pos`,
              Prisma.sql`t.id AS tie`,
            ],
            ', ',
          )} FROM tasks t ${joins(plan.taskJoins)} WHERE t.id IN (${idList(taskIds)})`
        : null;

    const ticketPart =
      ticketIds.length > 0
        ? Prisma.sql`SELECT k.id AS id, 'TICKET'::text AS kind, ${Prisma.join(
            [
              ...plan.keys.map((key, index) => Prisma.sql`${key.ticket} AS ${keyAlias(index)}`),
              Prisma.sql`k.position::double precision AS pos`,
              Prisma.sql`k.id AS tie`,
            ],
            ', ',
          )} FROM tickets k ${joins(plan.ticketJoins)} WHERE k.id IN (${idList(ticketIds)})`
        : null;

    const body =
      taskPart && ticketPart
        ? Prisma.sql`${taskPart} UNION ALL ${ticketPart}`
        : (taskPart ?? (ticketPart as Prisma.Sql));

    const orderBy = Prisma.join(
      [
        ...plan.keys.map(
          (key, index) => Prisma.sql`${keyAlias(index)} ${DIRECTION[key.direction]} NULLS LAST`,
        ),
        Prisma.sql`pos ASC`,
        Prisma.sql`tie ASC`,
      ],
      ', ',
    );

    return this.prisma.$queryRaw<OrderedId[]>`
      WITH ordered AS (${body})
      SELECT id, kind FROM ordered ORDER BY ${orderBy} LIMIT ${take}
    `;
  }
}

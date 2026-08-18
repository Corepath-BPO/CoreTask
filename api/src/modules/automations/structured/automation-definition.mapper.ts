import { ConditionGroupOperator, type AutomationBranchType } from '@coretask/contracts';
import type {
  AutomationActionDefinition,
  AutomationBranchDefinition,
  AutomationConditionDefinition,
  AutomationConditionGroupDefinition,
  AutomationRuleDefinition,
} from '@coretask/types';
import type {
  AutomationAction,
  AutomationBranch,
  AutomationCondition,
  AutomationConditionGroup,
  AutomationRule,
  AutomationRuleVersion,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Rows to the definition the builder reads, and back again.
 *
 * Every ordering here is taken from `position` and never from the order rows
 * arrived in. A Prisma `include` without an `orderBy` returns whatever the
 * planner found convenient, and a rule whose actions came back in insertion
 * order once and in index order the next time would run its steps in an order
 * nobody chose — the reordering the structured model exists to make cheap would
 * be the first thing it got wrong.
 */

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

export type ConditionGroupRow = AutomationConditionGroup & {
  conditions: AutomationCondition[];
};

export type BranchRow = AutomationBranch & {
  conditionGroup: ConditionGroupRow | null;
  actions: AutomationAction[];
};

export type VersionRow = AutomationRuleVersion & { branches: BranchRow[] };

/**
 * Everything a version needs to become a definition, in one query.
 *
 * The `orderBy` clauses are belt and braces — the mapper sorts anyway — but
 * they keep the rows arriving in the order they will be read, so a query log
 * shows the rule in the shape somebody would recognise.
 */
export const definitionInclude = {
  branches: {
    orderBy: { position: 'asc' },
    include: {
      conditionGroup: { include: { conditions: { orderBy: { position: 'asc' } } } },
      actions: { orderBy: { position: 'asc' } },
    },
  },
} satisfies Prisma.AutomationRuleVersionInclude;

/* -------------------------------------------------------------------------- */
/* Rows to definition                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One version of a rule as the builder loads it.
 *
 * `publishedVersion` is passed in rather than read off the rule, because the
 * rule row holds the published version's *id* and the builder needs its
 * *number*: "editing version 4, running version 3" is what the unpublished
 * changes badge is derived from, and an id says nothing about which came first.
 */
export function toDefinition(
  rule: AutomationRule,
  version: VersionRow,
  publishedVersion: number | null,
): AutomationRuleDefinition {
  return {
    id: rule.id,
    projectId: rule.projectId,
    name: rule.name,
    description: rule.description,
    status: rule.status,
    nameMode: rule.nameMode,
    version: version.version,
    publishedVersion,
    trigger: {
      type: version.triggerType,
      configuration: asRecord(version.triggerConfig),
    },
    branches: [...version.branches].sort(byPosition).map((branch) => toBranchDefinition(branch)),
    publishedAt: rule.publishedAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    /*
     * The version's timestamp, not the rule's. This is what the autosave
     * indicator shows, and a draft save writes the version rather than the
     * rule — reading the rule's would leave the indicator claiming the last
     * change was whenever somebody renamed it.
     */
    updatedAt: version.updatedAt.toISOString(),
  };
}

function toBranchDefinition(branch: BranchRow): AutomationBranchDefinition {
  return {
    id: branch.id,
    type: branch.type as AutomationBranchType,
    position: branch.position,
    conditionGroup: branch.conditionGroup ? toGroupDefinition(branch.conditionGroup) : null,
    actions: [...branch.actions].sort(byPosition).map((action): AutomationActionDefinition => ({
      id: action.id,
      actionType: action.actionType,
      configuration: asRecord(action.configuration),
      position: action.position,
    })),
  };
}

function toGroupDefinition(group: ConditionGroupRow): AutomationConditionGroupDefinition {
  return {
    id: group.id,
    operator: group.operator as ConditionGroupOperator,
    conditions: [...group.conditions]
      .sort(byPosition)
      .map((condition): AutomationConditionDefinition => ({
        id: condition.id,
        fieldKey: condition.fieldKey,
        operator: condition.operator,
        value: condition.value as unknown,
        position: condition.position,
      })),
  };
}

/* -------------------------------------------------------------------------- */
/* Definition to rows                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The branch writes for a version whose old rows are being deleted first.
 *
 * Ids are kept when the caller supplied a real one and minted otherwise. Kept,
 * because the builder holds a selection against them and regenerating on every
 * autosave would move the inspector off whatever somebody was typing into.
 * Minted when the id is not a uuid, because the columns are `@db.Uuid`: a
 * builder's own placeholder id — `branch-1` — is not a key this database can
 * store, and passing it through would fail the write rather than the request.
 *
 * A uuid belonging to some other rule's version is still refused, by the
 * primary key rather than by a lookup here; the service turns that collision
 * into a bad request.
 */
export function toBranchCreateInputs(
  branches: readonly AutomationBranchDefinition[],
): Prisma.AutomationBranchCreateWithoutRuleVersionInput[] {
  return branchWrites(branches, keyFor);
}

/**
 * The branch writes for a version being copied while the original stays.
 *
 * Every id is fresh. A copy is what publishing leaves behind for continued
 * editing, and the rows it was copied from are still there — reusing their ids
 * collides on the primary key, so the copy has to be a new set of rows that
 * happen to say the same thing.
 */
export function toBranchCopyInputs(
  branches: readonly AutomationBranchDefinition[],
): Prisma.AutomationBranchCreateWithoutRuleVersionInput[] {
  return branchWrites(branches, () => randomUUID());
}

type KeyStrategy = (id: string) => string;

function branchWrites(
  branches: readonly AutomationBranchDefinition[],
  key: KeyStrategy,
): Prisma.AutomationBranchCreateWithoutRuleVersionInput[] {
  return [...branches].sort(byPosition).map((branch) => ({
    id: key(branch.id),
    type: branch.type,
    position: branch.position,
    conditionGroup: branch.conditionGroup
      ? { create: toGroupCreate(branch.conditionGroup, key) }
      : undefined,
    actions: {
      create: [...branch.actions].sort(byPosition).map((action) => ({
        id: key(action.id),
        actionType: action.actionType,
        configuration: action.configuration as Prisma.InputJsonValue,
        position: action.position,
      })),
    },
  }));
}

function toGroupCreate(
  group: AutomationConditionGroupDefinition,
  key: KeyStrategy,
): Prisma.AutomationConditionGroupCreateWithoutBranchInput {
  return {
    id: key(group.id),
    operator: group.operator,
    conditions: {
      create: [...group.conditions].sort(byPosition).map((condition) => ({
        id: key(condition.id),
        fieldKey: condition.fieldKey,
        operator: condition.operator,
        /*
         * `null` is a value a condition legitimately holds — every operator
         * that carries its whole question, `is empty` and `is overdue` among
         * them, stores one — so it is written as JSON null rather than left
         * out, which Prisma would read as "do not set this column".
         */
        value: (condition.value ?? null) as Prisma.InputJsonValue,
        position: condition.position,
      })),
    },
  };
}

/* -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a string can be a key in a `@db.Uuid` column. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function keyFor(id: string): string {
  return isUuid(id) ? id : randomUUID();
}

function byPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position;
}

/**
 * A JSON column read as an object.
 *
 * The columns default to `{}` and the shapes above are all objects, but a
 * hand-written row or an older client could hold a scalar or an array, and
 * spreading one of those into a configuration would produce a rule whose
 * settings are numeric keys. An empty object is the honest reading: nothing
 * was configured.
 */
function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  return value as Record<string, unknown>;
}

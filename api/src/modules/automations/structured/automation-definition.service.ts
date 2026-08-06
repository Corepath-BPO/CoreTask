import {
  AutomationRuleStatus,
  ConditionGroupOperator,
  GraphIssueLevel,
  WorkspaceRole,
  hasAtLeastRole,
  type AutomationBranchType,
} from '@coretask/contracts';
import type { AutomationBranchDefinition, AutomationRuleDefinition } from '@coretask/types';
import {
  saveRuleDefinitionSchema,
  validateRuleDefinition,
  type RuleIssue,
  type SaveRuleBranchInput,
} from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import { ProjectsService } from '../../projects/projects.service';

import {
  definitionInclude,
  toBranchCreateInputs,
  toDefinition,
  type VersionRow,
} from './automation-definition.mapper';
import {
  ConfigKind,
  checkShapes,
  checkWritable,
  collectReferences,
  type CheckableDefinition,
  type DefinitionIssue,
  type DefinitionReference,
  type ReferenceKind,
} from './automation-definition.references';
import { convertLegacyRule } from './automation-legacy.converter';

/**
 * The structured rule: a trigger and an ordered list of branches.
 *
 * Runs alongside `AutomationsService`, which still owns the node tree every
 * live rule executes from. Nothing here writes `automation_nodes` and nothing
 * there writes these tables — the two models are read together and written
 * apart, which is the only way the phased migration can be abandoned halfway
 * without leaving a rule that neither model can explain.
 *
 * The rule this service exists to keep is that **publishing never changes what
 * is already running**. A draft and a published version are different rows, and
 * every path below is arranged so an edit lands on the draft and only a publish
 * moves the pointer.
 */

/**
 * A definition and everything wrong with it.
 *
 * Returned from every route rather than only from the save, because the builder
 * has to grey out Publish the moment a rule is opened — a rule that became
 * unpublishable while nobody was looking, because the section it names was
 * deleted, must say so before somebody presses the button rather than after.
 */
export interface AutomationDefinitionResult {
  definition: AutomationRuleDefinition;
  issues: RuleIssue[];
  publishable: boolean;
}

/** A rule with the two version pointers resolved to their numbers. */
type RuleRow = Prisma.AutomationRuleGetPayload<Record<string, never>>;

@Injectable()
export class AutomationDefinitionService {
  private readonly logger = new Logger(AutomationDefinitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Read                                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * The draft, converting the rule's node tree the first time it is asked for.
   *
   * A read that writes, deliberately. Every rule in production predates these
   * tables, and the alternative to converting on first read is a backfill that
   * has to have run before anybody opens the builder — which means a rule
   * created between the backfill and the deployment opens empty and looks like
   * its steps were lost. Converting here makes the question "has this rule been
   * converted yet?" one nobody has to ask.
   */
  async getDraft(
    workspaceId: string,
    projectId: string,
    ruleId: string,
  ): Promise<AutomationDefinitionResult> {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    const draft = await this.requireDraft(rule);

    return this.resultFor(rule, draft);
  }

  /* ------------------------------------------------------------------------ */
  /* Write                                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * Replaces the draft's branches with the ones supplied.
   *
   * Wholesale rather than diffed, for the reason the node tree is: a builder
   * sends the rule as it now stands, and reconciling that against stored rows
   * means guessing which branch is "the same" one. Guessing wrong silently
   * rewires a rule, and a rule is a thing that acts on somebody's work without
   * being watched.
   */
  async saveDraft(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    ruleId: string,
    body: unknown,
  ): Promise<AutomationDefinitionResult> {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    const parsed = saveRuleDefinitionSchema.safeParse(body);
    if (!parsed.success) {
      throw AppException.unprocessable('VALIDATION_FAILED', 'This rule could not be read.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const branches = parsed.data.branches.map(toBranchDefinition);
    const trigger = { type: parsed.data.trigger.type, configuration: parsed.data.trigger.configuration };
    const candidate: CheckableDefinition = { trigger, branches };

    const issues = [
      ...checkWritable(branches),
      ...checkShapes(candidate),
      ...(await this.checkReferences(workspaceId, projectId, candidate)),
    ];

    this.refuseIf(issues.filter((issue) => issue.blocksDraft), 'This rule could not be saved.');

    /* Ensure there is a draft before the write, so a rule that has never been
     * opened can still be saved into — the conversion is what gives it one. */
    await this.requireDraft(rule);

    const saved = await this.prisma.$transaction(async (tx) => {
      /*
       * The draft pointer is re-read inside the transaction and checked against
       * the published one. A publish that landed between this request loading
       * the rule and writing it will have moved the pointer, and writing to the
       * id we started with would edit the version that is now live — the exact
       * thing versions exist to prevent.
       */
      const fresh = await tx.automationRule.findUniqueOrThrow({ where: { id: rule.id } });

      if (!fresh.draftVersionId || fresh.draftVersionId === fresh.publishedVersionId) {
        throw AppException.conflict(
          'RESOURCE_CONFLICT',
          'This rule was published while you were editing. Reload it and try again.',
        );
      }

      await tx.automationBranch.deleteMany({ where: { ruleVersionId: fresh.draftVersionId } });

      await tx.automationRuleVersion.update({
        where: { id: fresh.draftVersionId },
        data: {
          triggerType: trigger.type,
          triggerConfig: trigger.configuration as Prisma.InputJsonValue,
          branches: { create: toBranchCreateInputs(branches) },
        },
      });

      /*
       * The rule's own trigger columns are deliberately not touched. They are
       * how the matcher finds candidate rules with one indexed query, so they
       * describe what is *running* — moving them here would make a live rule
       * start firing on a different event the moment somebody typed, without
       * anybody publishing anything. Only `publish` moves them.
       */
      return tx.automationRule.update({
        where: { id: rule.id },
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          ...(parsed.data.nameMode ? { nameMode: parsed.data.nameMode } : {}),
        },
      });
    }, TRANSACTION_OPTIONS).catch(rethrowDuplicateId);

    return this.resultFor(saved, await this.loadVersion(saved.draftVersionId));
  }

  /* ------------------------------------------------------------------------ */
  /* Publish                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Makes the draft the running version, and leaves a new draft behind it.
   *
   * The draft row becomes the published row and a copy of it becomes the new
   * draft. That way round rather than the other because of what it makes
   * impossible: after this returns, `draftVersionId` names a row that has never
   * been published, so every later save writes there and the published rows
   * accumulate as a history that nothing edits. Publishing does not change a
   * running rule — it points the rule at a different row.
   */
  async publish(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    ruleId: string,
  ): Promise<AutomationDefinitionResult> {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    const draft = await this.requireDraft(rule);
    const definition = toDefinition(rule, draft, null);

    const issues = [
      ...validateRuleDefinition(definition).map(asBlocking),
      ...checkWritable(definition.branches),
      ...checkShapes(definition),
      ...(await this.checkReferences(workspaceId, projectId, definition)),
    ];

    this.refuseIf(issues, 'This rule is not ready to publish.');

    const published = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.automationRule.findUniqueOrThrow({ where: { id: rule.id } });

      if (fresh.draftVersionId !== draft.id) {
        throw AppException.conflict(
          'RESOURCE_CONFLICT',
          'This rule changed while it was being published. Reload it and try again.',
        );
      }

      const nextDraft = await tx.automationRuleVersion.create({
        data: {
          ruleId: rule.id,
          version: draft.version + 1,
          triggerType: draft.triggerType,
          triggerConfig: draft.triggerConfig as Prisma.InputJsonValue,
          createdById: userId,
          branches: { create: toBranchCreateInputs(definition.branches) },
        },
      });

      return tx.automationRule.update({
        where: { id: rule.id },
        data: {
          status: AutomationRuleStatus.ACTIVE,
          publishedAt: new Date(),
          publishedVersionId: draft.id,
          draftVersionId: nextDraft.id,
          version: nextDraft.version,
          /*
           * The denormalised trigger follows the *published* version and only
           * moves here. It is what the matcher's indexed query reads, so it has
           * to describe the version that is running — left behind, a republished
           * rule would keep firing on the trigger it used to have.
           */
          triggerType: draft.triggerType,
          triggerConfig: draft.triggerConfig as Prisma.InputJsonValue,
        },
      });
    }, TRANSACTION_OPTIONS).catch(rethrowDuplicateId);

    return this.resultFor(published, await this.loadVersion(published.draftVersionId));
  }

  /* ------------------------------------------------------------------------ */
  /* Drafts                                                                    */
  /* ------------------------------------------------------------------------ */

  /** The draft version, created from the node tree if the rule has none yet. */
  private async requireDraft(rule: RuleRow): Promise<VersionRow> {
    if (rule.draftVersionId) {
      const existing = await this.prisma.automationRuleVersion.findUnique({
        where: { id: rule.draftVersionId },
        include: definitionInclude,
      });

      if (existing) return existing;
    }

    return this.convertFromNodes(rule);
  }

  /**
   * Builds the first draft from the rule's node tree.
   *
   * The conversion itself is pure and lives next door; this is only the part
   * that needs the database. Two requests arriving together both try to create
   * version 1, and the second loses on `@@unique([ruleId, version])` rather
   * than on a lock — at which point the draft it wanted exists, so it reads it.
   */
  private async convertFromNodes(rule: RuleRow): Promise<VersionRow> {
    const nodes = await this.prisma.automationNode.findMany({
      where: { ruleId: rule.id },
      orderBy: { position: 'asc' },
    });

    const converted = convertLegacyRule(
      nodes.map((node) => ({
        id: node.id,
        nodeType: node.nodeType,
        subtype: node.subtype,
        configuration: node.configuration as Record<string, unknown> | null,
        parentNodeId: node.parentNodeId,
        branchKey: node.branchKey,
        position: node.position,
      })),
      { triggerType: rule.triggerType, triggerConfig: rule.triggerConfig as Record<string, unknown> },
      randomUUID,
    );

    if (converted.notes.length > 0) {
      /* Logged rather than returned: the person opening the builder cannot act
       * on "a delay was dropped" mid-edit, and whoever is running the migration
       * needs to know which rules did not survive it intact. */
      this.logger.warn(
        `Rule ${rule.id} converted with losses: ${converted.notes.join(' ')}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.automationRuleVersion.aggregate({
          where: { ruleId: rule.id },
          _max: { version: true },
        });

        const created = await tx.automationRuleVersion.create({
          data: {
            ruleId: rule.id,
            version: (latest._max.version ?? 0) + 1,
            triggerType: converted.trigger.type,
            triggerConfig: converted.trigger.configuration as Prisma.InputJsonValue,
            createdById: rule.createdById,
            branches: { create: toBranchCreateInputs(converted.branches) },
          },
          include: definitionInclude,
        });

        await tx.automationRule.update({
          where: { id: rule.id },
          data: { draftVersionId: created.id },
        });

        return created;
      }, TRANSACTION_OPTIONS);
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw cause;

      const rival = await this.prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } });
      return this.loadVersion(rival.draftVersionId);
    }
  }

  private async loadVersion(versionId: string | null): Promise<VersionRow> {
    if (!versionId) {
      /* Only reachable if something outside this service cleared the pointer
       * between the write and the read, which is a bug rather than a state. */
      throw AppException.conflict('RESOURCE_CONFLICT', 'This rule has no draft to read.');
    }

    return this.prisma.automationRuleVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: definitionInclude,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* References                                                                */
  /* ------------------------------------------------------------------------ */

  /**
   * Everything the rule points at has to still be here, and be here in *this*
   * project.
   *
   * The scoping matters as much as the existence. A rule that assigns somebody
   * from another workspace, or moves a task into another project's section, is
   * not a broken rule — it is a way of reaching across a tenant boundary, using
   * an automation as the thing that does the reaching. Refused on save as well
   * as on publish, because the row is the reach.
   */
  private async checkReferences(
    workspaceId: string,
    projectId: string,
    definition: CheckableDefinition,
  ): Promise<DefinitionIssue[]> {
    const references = collectReferences(definition);
    if (references.length === 0) return [];

    const idsOf = (kind: ReferenceKind) => [
      ...new Set(references.filter((it) => it.kind === kind).map((it) => it.id)),
    ];

    const sectionIds = idsOf(ConfigKind.SECTION);
    const memberIds = idsOf(ConfigKind.MEMBER);
    const statusIds = idsOf(ConfigKind.STATUS);
    const priorityIds = idsOf(ConfigKind.PRIORITY);
    const fieldIds = idsOf(ConfigKind.CUSTOM_FIELD);

    const [sections, members, statuses, priorities, fields] = await Promise.all([
      sectionIds.length
        ? this.prisma.section.findMany({
            where: { id: { in: sectionIds }, projectId },
            select: { id: true },
          })
        : [],
      memberIds.length
        ? this.prisma.workspaceMember.findMany({
            where: { workspaceId, userId: { in: memberIds } },
            select: { userId: true },
          })
        : [],
      statusIds.length
        ? this.prisma.statusDefinition.findMany({
            /* A project's own statuses and the workspace-wide set both count —
             * the second is what a project inherits when it defines none. */
            where: {
              id: { in: statusIds },
              workspaceId,
              OR: [{ projectId }, { projectId: null }],
            },
            select: { id: true },
          })
        : [],
      priorityIds.length
        ? this.prisma.priorityDefinition.findMany({
            where: { id: { in: priorityIds }, workspaceId },
            select: { id: true },
          })
        : [],
      fieldIds.length
        ? this.prisma.customField.findMany({
            where: { id: { in: fieldIds }, workspaceId, isArchived: false },
            select: { id: true },
          })
        : [],
    ]);

    const live: Record<ReferenceKind, Set<string>> = {
      SECTION: new Set(sections.map((row) => row.id)),
      MEMBER: new Set(members.map((row) => row.userId)),
      STATUS: new Set(statuses.map((row) => row.id)),
      PRIORITY: new Set(priorities.map((row) => row.id)),
      CUSTOM_FIELD: new Set(fields.map((row) => row.id)),
    };

    return references
      .filter((reference) => !live[reference.kind].has(reference.id))
      .map((reference) => ({
        level: GraphIssueLevel.ERROR,
        nodeId: reference.branchId,
        path: reference.path,
        message: MISSING_REFERENCE[reference.kind],
        blocksDraft: true,
      }));
  }

  /* ------------------------------------------------------------------------ */

  private async resultFor(rule: RuleRow, version: VersionRow): Promise<AutomationDefinitionResult> {
    const publishedVersion = rule.publishedVersionId
      ? ((
          await this.prisma.automationRuleVersion.findUnique({
            where: { id: rule.publishedVersionId },
            select: { version: true },
          })
        )?.version ?? null)
      : null;

    const definition = toDefinition(rule, version, publishedVersion);

    const issues: RuleIssue[] = [
      ...validateRuleDefinition(definition),
      ...checkShapes(definition),
      ...(await this.checkReferences(rule.workspaceId, rule.projectId, definition)),
    ].map(stripBlocking);

    return {
      definition,
      issues,
      publishable: !issues.some((issue) => issue.level === GraphIssueLevel.ERROR),
    };
  }

  /** Refuses the request if anything in the list is an error. */
  private refuseIf(issues: readonly DefinitionIssue[], message: string): void {
    const errors = issues.filter((issue) => issue.level === GraphIssueLevel.ERROR);
    if (errors.length === 0) return;

    throw AppException.badRequest('BAD_REQUEST', message, { issues: errors.map(stripBlocking) });
  }

  private assertMayManage(role: WorkspaceRole): void {
    if (!hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only a workspace manager can change automations.');
    }
  }

  /**
   * Loads a rule *within a workspace and project*.
   *
   * Both ids are in the filter for the same reason the rest of the API puts
   * them there: an id from another tenant has to look like it does not exist,
   * not like something the caller is not allowed to see.
   */
  private async requireRule(
    workspaceId: string,
    projectId: string,
    ruleId: string,
  ): Promise<RuleRow> {
    await this.projects.requireProject(workspaceId, projectId);

    const rule = await this.prisma.automationRule.findFirst({
      where: { id: ruleId, projectId, workspaceId },
    });

    if (!rule) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Automation not found.');
    }

    return rule;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Long enough for a rule at its limits.
 *
 * Twenty branches of twenty conditions and twenty-five actions is a thousand
 * rows in one transaction, and the default five-second budget is comfortable
 * for a normal rule and not for that one. A publish that times out halfway is
 * the one outcome this whole design refuses.
 */
const TRANSACTION_OPTIONS = { timeout: 20_000 } as const;

const MISSING_REFERENCE: Record<ReferenceKind, string> = {
  SECTION: 'That section is not in this project.',
  MEMBER: 'That person is not a member of this workspace.',
  STATUS: 'That status is not available in this project.',
  PRIORITY: 'That priority is not available in this workspace.',
  CUSTOM_FIELD: 'That field is not in this workspace.',
};

/** The shared validator's issues, in the tagged shape the two paths merge into. */
function asBlocking(issue: RuleIssue): DefinitionIssue {
  return { ...issue, blocksDraft: false };
}

/** The tag is an internal decision, not something a client should read. */
function stripBlocking(issue: DefinitionIssue | RuleIssue): RuleIssue {
  return { level: issue.level, nodeId: issue.nodeId, path: issue.path, message: issue.message };
}

/**
 * A parsed branch as the rest of this module reads it.
 *
 * Zod leaves `conditionGroup` as absent-or-null because a client may send
 * either; the definition has one answer — `null` means this branch is chosen by
 * nothing above it having matched — and normalising here keeps every reader
 * from having to know that two spellings arrive.
 */
function toBranchDefinition(branch: SaveRuleBranchInput): AutomationBranchDefinition {
  return {
    id: branch.id,
    type: branch.type as AutomationBranchType,
    position: branch.position,
    conditionGroup: branch.conditionGroup
      ? {
          id: branch.conditionGroup.id,
          operator: branch.conditionGroup.operator as ConditionGroupOperator,
          conditions: branch.conditionGroup.conditions,
        }
      : null,
    actions: branch.actions,
  };
}

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002';
}

/**
 * An id the caller supplied that is already somebody else's.
 *
 * Branch, condition and action ids are kept when they are uuids, so the builder
 * can hold a selection across an autosave. The cost is that a client can send
 * an id belonging to another rule's version, which the primary key refuses —
 * reported as the bad request it is rather than surfacing as a 500.
 */
function rethrowDuplicateId(cause: unknown): never {
  if (isUniqueViolation(cause)) {
    throw AppException.badRequest(
      'BAD_REQUEST',
      'One of the ids in this rule is already in use somewhere else.',
    );
  }

  throw cause;
}

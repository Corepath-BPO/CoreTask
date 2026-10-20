import {
  AUTOMATION_TRIGGERS,
  AutomationNodeType,
  AutomationRuleStatus,
  AutomationTrigger,
  GraphIssueLevel,
  isTimeZone,
  WorkspaceRole,
  hasAtLeastRole,
  rulesForSection,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma as PrismaNamespace, type AutomationRule, type Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, type ActorContext } from '../../common/types/api.types';
import {
  buildPaginationMeta,
  toSkipTake,
  type PageRequest,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { ProjectsService } from '../projects/projects.service';

import { AutomationEventPublisher } from './automation-event.publisher';

import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { toGraph } from './builder/automation-graph.mapper';
import type { CreateRuleDto, UpdateRuleDto } from './dto/automation.dto';
import {
  readSnapshot,
  sameConfig,
  sameGraph,
  snapshotOf,
  type SnapshotNode,
} from './versions/rule-snapshot';

/** One node as the builder sends it. Mirrors `SaveAutomationGraphNode`. */
export interface GraphNodeInput {
  id?: string;
  nodeType: string;
  subtype: string;
  configuration?: Record<string, unknown>;
  position?: { x: number; y: number };
  parentId?: string | null;
  branchKey?: string | null;
  order?: number;
}

const ruleInclude = {
  nodes: { orderBy: { position: 'asc' } },
  createdBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.AutomationRuleInclude;

/** The most versions the history lists. A rule republished more than this keeps the rest. */
const MAX_LISTED_VERSIONS = 100;

const versionSelect = {
  id: true,
  version: true,
  name: true,
  triggerType: true,
  triggerConfig: true,
  nodes: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.AutomationRuleVersionSelect;

type VersionRow = Prisma.AutomationRuleVersionGetPayload<{ select: typeof versionSelect }>;

/** A published version, as the history and the builder's header show it. */
export interface VersionSummary {
  id: string;
  version: number;
  name: string | null;
  triggerType: string;
  /** When it was published — a version is created by publishing it. */
  publishedAt: string;
  publishedBy: { id: string; name: string; avatarUrl: string | null } | null;
  /** Whether this is the version the rule is running now. */
  isPublished: boolean;
  /** How many steps it has after its trigger, so a list can tell versions apart. */
  stepCount: number;
}

function toVersionSummary(row: VersionRow, publishedVersionId: string | null): VersionSummary {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    triggerType: row.triggerType,
    publishedAt: row.createdAt.toISOString(),
    publishedBy: row.createdBy,
    isPublished: row.id === publishedVersionId,
    stepCount: (readSnapshot(row.nodes) ?? []).filter((node) => node.nodeType !== 'TRIGGER').length,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id a client's node may keep: a uuid as it stands, or the uuid inside the
 * `new-<uuid>` a builder names a step it has not saved yet. See `replaceNodes`.
 */
function keepableId(id: string | undefined): string | null {
  if (!id) return null;
  const candidate = id.startsWith('new-') ? id.slice('new-'.length) : id;
  return UUID.test(candidate) ? candidate.toLowerCase() : null;
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly graph: AutomationGraphValidatorService,
    private readonly access: ProjectAccessService,
    private readonly publisher: AutomationEventPublisher,
  ) {}

  async list(workspaceId: string, projectId: string, sectionId?: string) {
    await this.projects.requireProject(workspaceId, projectId);

    const rules = await this.prisma.automationRule.findMany({
      where: {
        projectId,
        status: { not: AutomationRuleStatus.ARCHIVED },
      },
      include: {
        ...ruleInclude,
        // What is running, which the draft's trigger columns may have moved on
        // from — a task's "Run rule" menu lists rules by the trigger that runs.
        publishedVersion: { select: { version: true, triggerType: true, triggerConfig: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    /*
     * Section scoping is worked out from the rule, not from a column.
     *
     * The section a rule belongs to is part of what it watches — a trigger
     * scoped to the section, or a "Section is…" check — and a denormalised
     * column would eventually disagree with the graph it was copied from.
     *
     * Read in memory rather than as a JSON path filter on the trigger, because
     * the trigger is only half of it. A rule started from a section's lightning
     * menu carries the section as a condition, and keeps it when its trigger is
     * changed to "task completed"; the old filter saw only the trigger, so the
     * rule stayed on the project while vanishing from the section it was made
     * for. A project's rules are few, so nothing is lost by reading them all.
     */
    return sectionId ? rulesForSection(rules, sectionId) : rules;
  }

  async get(workspaceId: string, projectId: string, ruleId: string) {
    return this.requireRule(workspaceId, projectId, ruleId);
  }

  async create(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    dto: CreateRuleDto,
  ) {
    await this.projects.requireProject(workspaceId, projectId);
    this.assertMayManage(role);

    // Created as a DRAFT regardless of what was asked for. A rule becomes live
    // through `publish`, which validates it — otherwise a half-built rule could
    // start acting on real tasks the moment it was saved.
    const rule = await this.prisma.automationRule.create({
      data: {
        workspaceId,
        projectId,
        name: dto.name,
        description: dto.description ?? null,
        status: AutomationRuleStatus.DRAFT,
        triggerType: dto.triggerType,
        triggerConfig: (dto.triggerConfig ?? {}) as Prisma.InputJsonValue,
        createdById: userId,
      },
      include: ruleInclude,
    });

    /*
     * Nodes are written by the same path an update uses.
     *
     * They were inlined here once, which meant `create` quietly dropped
     * positions and parentage while `update` kept them — a rule saved on its
     * first write came back flat, and only started holding its shape on the
     * second.
     */
    if (dto.nodes?.length) {
      await this.replaceNodes(rule.id, dto.nodes);
      return this.get(workspaceId, projectId, rule.id);
    }

    return rule;
  }

  async update(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    ruleId: string,
    dto: UpdateRuleDto,
  ) {
    await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    const data: Prisma.AutomationRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.allowChaining !== undefined) data.allowChaining = dto.allowChaining;
    if (dto.triggerType !== undefined) data.triggerType = dto.triggerType;
    if (dto.triggerConfig !== undefined) {
      data.triggerConfig = dto.triggerConfig as Prisma.InputJsonValue;
    }

    /*
     * Nodes are replaced wholesale rather than diffed.
     *
     * A builder sends the canvas as it now stands; reconciling that against
     * stored rows means guessing which node is "the same" one, and guessing
     * wrong silently rewires a rule. Replacing is unambiguous, and the version
     * counter records that the shape changed.
     */
    if (dto.nodes) {
      await this.replaceNodes(ruleId, dto.nodes);
      data.version = { increment: 1 };

      /*
       * The rule's own trigger columns follow the trigger node.
       *
       * `triggerType` on the row is a denormalisation of the graph — it is how
       * the runner finds candidate rules without loading everybody's nodes —
       * and until now only an explicit field kept it current. A builder that
       * saved a changed trigger as part of the canvas would leave the two
       * disagreeing: the rule would show one trigger and fire on another.
       *
       * Derived here rather than asked of the caller, so the invariant holds
       * for any client. An explicit value still wins, and a graph saved without
       * a trigger leaves the columns alone rather than blanking them.
       */
      const trigger = dto.nodes.find((node) => node.nodeType === AutomationNodeType.TRIGGER);

      if (trigger && dto.triggerType === undefined) {
        data.triggerType = trigger.subtype;
      }
      if (trigger && dto.triggerConfig === undefined) {
        data.triggerConfig = (trigger.configuration ?? {}) as Prisma.InputJsonValue;
      }
    }

    return this.prisma.automationRule.update({
      where: { id: ruleId },
      data,
      include: ruleInclude,
    });
  }

  /**
   * Writes the graph, keeping the ids the builder sent.
   *
   * Nodes are replaced wholesale rather than diffed — a builder sends the canvas
   * as it now stands, and reconciling that against stored rows means guessing
   * which node is "the same" one. Guessing wrong silently rewires a rule.
   *
   * A step keeps its id from one save to the next. Every save used to give
   * every step a new one, so a builder that autosaves while somebody is typing
   * into a step lost the step from under the cursor: the panel it was open in
   * named an id the rule no longer had. So an id is kept when it is one of this
   * rule's own steps, and a new step's `new-<uuid>` becomes that uuid — the
   * builder makes the same translation, so its selection survives the save.
   * Anything else is given a fresh id: an id that is another rule's step, or
   * not a uuid at all, is a name the caller chose, never a row it may claim.
   *
   * Two passes, because a parent may appear after its child in the array and a
   * self-referencing insert cannot resolve forward.
   */
  private async replaceNodes(ruleId: string, nodes: GraphNodeInput[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const own = new Set(
        (await tx.automationNode.findMany({ where: { ruleId }, select: { id: true } })).map(
          (node) => node.id,
        ),
      );
      await tx.automationNode.deleteMany({ where: { ruleId } });

      const wanted = nodes.map((node) => keepableId(node.id)).filter(Boolean) as string[];
      const taken = new Set(
        (
          await tx.automationNode.findMany({
            where: { id: { in: wanted.filter((id) => !own.has(id)) } },
            select: { id: true },
          })
        ).map((node) => node.id),
      );

      // Client ids are opaque strings until mapped here, so `parentId` stays
      // meaningful without trusting anything the client says about identity.
      const realId = new Map<string, string>();
      const used = new Set<string>();
      // Only nodes that named themselves go in the map. One that did not came
      // from the old flat API, has no children, and needs no entry — nothing
      // will ever look it up.
      for (const node of nodes) {
        if (!node.id || realId.has(node.id)) continue;
        const kept = keepableId(node.id);
        const id = kept && !taken.has(kept) && !used.has(kept) ? kept : randomUUID();
        used.add(id);
        realId.set(node.id, id);
      }

      await tx.automationNode.createMany({
        data: nodes.map((node, index) => ({
          id: (node.id ? realId.get(node.id) : undefined) ?? randomUUID(),
          ruleId,
          nodeType: node.nodeType as AutomationNodeType,
          subtype: node.subtype,
          configuration: (node.configuration ?? {}) as Prisma.InputJsonValue,
          positionX: node.position?.x ?? 0,
          positionY: node.position?.y ?? 0,
          branchKey: node.branchKey ?? null,
          position: node.order ?? index,
        })),
      });

      // Parents in a second pass: `createMany` cannot reference rows it is in
      // the middle of inserting.
      for (const node of nodes) {
        if (!node.parentId || !node.id) continue;

        const parent = realId.get(node.parentId);
        const child = realId.get(node.id);
        if (!parent || !child) continue;

        await tx.automationNode.update({
          where: { id: child },
          data: { parentNodeId: parent },
        });
      }
    });
  }

  /**
   * Makes a rule live, after checking it can actually run.
   *
   * Publishing is the only path to ACTIVE, and these checks are the reason: a
   * rule with no action does nothing, one with no trigger never fires, and one
   * naming a deleted section fails silently on every event. Each is invisible
   * until someone wonders why their automation "isn't working".
   *
   * Everything the rule builder refuses is refused here too, by running the
   * same validator the builder's problem count comes from. This used to be a
   * shorter check of its own, so the panel and the endpoint disagreed about
   * what a valid rule was: a graph posted straight to this route went ACTIVE
   * carrying faults the form would not have let anybody build — a deleted
   * section, a comparison that does not fit the field, a computed date on a
   * text field. The builder greying Publish out was never the refusal; it was
   * only the part somebody could see.
   *
   * The stored graph is what gets validated, not a body — by the time anything
   * is published the request that wrote it is long gone, and the rule that goes
   * live is the one in the table.
   */
  async publish(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    ruleId: string,
    /** Who published, recorded on the version. Absent for a bundle writing rules. */
    userId?: string,
  ) {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    const { issues } = await this.graph.validate(projectId, workspaceId, rule.name, rule.nodes);

    /*
     * Errors refuse; warnings do not.
     *
     * A warning is something worth saying and not worth blocking — "this action
     * can set off its own trigger" is occasionally the whole point of the rule
     * — and the builder already draws that line the same way. Publishing on an
     * error the panel shows would put the two back out of step.
     *
     * The graph answers for the nodes and `triggerProblems` for the row, so the
     * two halves meet here without overlapping: every sentence is a fault no
     * other sentence is also describing.
     *
     * Still deduplicated, for the case they cannot avoid: two steps naming the
     * same deleted section produce the same sentence twice, and this list is
     * sentences with no node beside them — so the repeat reads as a fault in
     * the message rather than as a second broken step. `/validate` is where
     * per-node detail lives, and it carries the `nodeId` that tells them apart.
     */
    const problems = [
      ...new Set([
        ...(await this.triggerProblems(rule)),
        ...issues
          .filter((issue) => issue.level === GraphIssueLevel.ERROR)
          .map((issue) => issue.message),
      ]),
    ];

    if (problems.length > 0) {
      throw AppException.badRequest('BAD_REQUEST', 'This rule is not ready to publish.', {
        problems,
      });
    }

    /*
     * The steps go live as a version, not as the rows somebody edits.
     *
     * The runner reads the published version and nothing else, so a save after
     * this changes the draft and leaves what is running alone until the next
     * publish. A draft that says exactly what the running version says — a
     * paused rule being resumed, a second press of Publish — points back at that
     * version rather than adding a copy of it to the history.
     */
    const draft = snapshotOf(rule.nodes);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = rule.publishedVersionId
          ? await tx.automationRuleVersion.findUnique({
              where: { id: rule.publishedVersionId },
              select: { id: true, nodes: true, triggerType: true, triggerConfig: true },
            })
          : null;
        const running = current ? readSnapshot(current.nodes) : null;

        const unchanged =
          current !== null &&
          running !== null &&
          current.triggerType === rule.triggerType &&
          sameConfig(current.triggerConfig, rule.triggerConfig) &&
          sameGraph(running, draft);

        const versionId = unchanged
          ? current.id
          : (
              await tx.automationRuleVersion.create({
                data: {
                  ruleId,
                  version: (await this.latestVersion(tx, ruleId)) + 1,
                  triggerType: rule.triggerType,
                  triggerConfig: rule.triggerConfig as Prisma.InputJsonValue,
                  nodes: draft as unknown as Prisma.InputJsonValue,
                  name: rule.name,
                  createdById: userId ?? null,
                },
                select: { id: true },
              })
            ).id;

        return tx.automationRule.update({
          where: { id: ruleId },
          data: {
            status: AutomationRuleStatus.ACTIVE,
            publishedAt: new Date(),
            publishedVersionId: versionId,
          },
          include: ruleInclude,
        });
      });
    } catch (error) {
      // Two publishes at once both reach for the next number; one wins.
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw AppException.conflict(
          'RESOURCE_CONFLICT',
          'This rule was published by someone else at the same moment. Reload it and try again.',
        );
      }
      throw error;
    }
  }

  private async latestVersion(tx: Prisma.TransactionClient, ruleId: string): Promise<number> {
    const latest = await tx.automationRuleVersion.aggregate({
      where: { ruleId },
      _max: { version: true },
    });
    return latest._max.version ?? 0;
  }

  /* ------------------------------------------------------------------------ */
  /* Versions                                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * What is running, and whether the draft says anything different.
   *
   * The builder's header reads this: a live rule whose draft matches what runs
   * has nothing to publish, and one that does not says so and offers to.
   */
  async versionState(rule: {
    publishedVersionId: string | null;
    triggerType: string;
    triggerConfig: Prisma.JsonValue;
    nodes: SnapshotNode[];
  }): Promise<{
    publishedVersion: VersionSummary | null;
    hasUnpublishedChanges: boolean;
  }> {
    if (!rule.publishedVersionId) return { publishedVersion: null, hasUnpublishedChanges: false };

    const published = await this.prisma.automationRuleVersion.findUnique({
      where: { id: rule.publishedVersionId },
      select: versionSelect,
    });
    if (!published) return { publishedVersion: null, hasUnpublishedChanges: false };

    const running = readSnapshot(published.nodes);
    const hasUnpublishedChanges =
      running === null ||
      published.triggerType !== rule.triggerType ||
      !sameConfig(published.triggerConfig, rule.triggerConfig) ||
      !sameGraph(running, snapshotOf(rule.nodes));

    return {
      publishedVersion: toVersionSummary(published, rule.publishedVersionId),
      hasUnpublishedChanges,
    };
  }

  /** Every version this rule has published, newest first. */
  async versions(workspaceId: string, projectId: string, ruleId: string) {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);

    const rows = await this.prisma.automationRuleVersion.findMany({
      // A draft the structured endpoints hold has no steps of this kind yet,
      // and has never run — it is not history.
      where: { ruleId, nodes: { not: PrismaNamespace.DbNull } },
      orderBy: { version: 'desc' },
      take: MAX_LISTED_VERSIONS,
      select: versionSelect,
    });

    return rows.map((row) => toVersionSummary(row, rule.publishedVersionId));
  }

  /** One version, with its steps drawn as the canvas draws a rule. */
  async version(workspaceId: string, projectId: string, ruleId: string, versionId: string) {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    const row = await this.requireVersion(ruleId, versionId);
    const nodes = readSnapshot(row.nodes) ?? [];

    return {
      ...toVersionSummary(row, rule.publishedVersionId),
      triggerConfig: row.triggerConfig,
      graph: toGraph(nodes),
    };
  }

  /**
   * Puts a published version back into the draft — and live, when asked.
   *
   * Into the draft first, because that is where every change to a rule goes:
   * the person sees the old steps on the canvas and decides. Restoring is then
   * one Publish away, which validates the steps against the project as it is
   * now — the section an old version moved tasks into may be gone. `publish`
   * does both in one call, for a rollback that cannot wait for a review; it is
   * refused exactly as a publish is.
   *
   * History is not rewritten. Publishing a restored version adds a new version
   * with the old steps, so the record still says that something else ran in
   * between, and when.
   */
  async revert(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    ruleId: string,
    versionId: string,
    userId: string,
    publish = false,
  ) {
    await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    const row = await this.requireVersion(ruleId, versionId);
    const nodes = readSnapshot(row.nodes) ?? [];

    await this.replaceNodes(
      ruleId,
      nodes.map((node) => ({
        id: node.id,
        nodeType: node.nodeType,
        subtype: node.subtype,
        configuration: (node.configuration ?? {}) as Record<string, unknown>,
        parentId: node.parentNodeId,
        branchKey: node.branchKey,
        order: node.position,
      })),
    );
    await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: {
        triggerType: row.triggerType,
        triggerConfig: row.triggerConfig as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    return publish
      ? this.publish(workspaceId, projectId, role, ruleId, userId)
      : this.get(workspaceId, projectId, ruleId);
  }

  private async requireVersion(ruleId: string, versionId: string) {
    const row = await this.prisma.automationRuleVersion.findFirst({
      where: { id: versionId, ruleId, nodes: { not: PrismaNamespace.DbNull } },
      select: { ...versionSelect, triggerConfig: true },
    });

    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Version not found.');
    return row;
  }

  /**
   * What is wrong with the rule's own row, rather than with its graph.
   *
   * The two trigger columns and nothing else. It used to check the nodes too —
   * that there was an action, and that each one names something the engine can
   * run — and the graph validator now answers both, from the same node tree, in
   * the same words the builder shows. Two validators saying the same thing
   * differently put two sentences for one fault in front of whoever pressed
   * Publish, each phrased just differently enough to read as two problems.
   *
   * What is left is the half the graph cannot answer. `triggerType` and
   * `triggerConfig` are columns on the rule, denormalised from the trigger node
   * so the matcher can find candidate rules with one indexed query — they are
   * what actually decides whether a rule sees an event, and a graph validator
   * reading nodes never looks at them.
   */
  private async triggerProblems(rule: AutomationRule): Promise<string[]> {
    const problems: string[] = [];

    if (!AUTOMATION_TRIGGERS.includes(rule.triggerType as never)) {
      problems.push('The trigger is not one this engine understands.');
    }

    // A section named in the trigger must still exist. A rule pointing at a
    // deleted section is not an error anywhere — it simply never fires.
    const config = (rule.triggerConfig ?? {}) as { sectionId?: string };

    if (config.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: config.sectionId, projectId: rule.projectId },
        select: { id: true },
      });

      if (!section) problems.push('The section this rule watches no longer exists.');
    }

    return problems;
  }

  async setStatus(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    ruleId: string,
    status: AutomationRuleStatus,
  ) {
    await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    return this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { status },
      include: ruleInclude,
    });
  }

  async duplicate(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    ruleId: string,
  ) {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    // A copy is always a draft. Duplicating a live rule and having both fire
    // immediately is never what anyone means by "duplicate".
    const copy = await this.prisma.automationRule.create({
      data: {
        workspaceId,
        projectId,
        name: `${rule.name} copy`,
        description: rule.description,
        status: AutomationRuleStatus.DRAFT,
        allowChaining: rule.allowChaining,
        triggerType: rule.triggerType,
        triggerConfig: rule.triggerConfig as Prisma.InputJsonValue,
        createdById: userId,
      },
      include: ruleInclude,
    });

    // A graph copy must remain a graph. Nested Prisma creates cannot point a
    // child at another row being created in the same array, so use the same
    // two-pass writer as the builder. The previous implementation copied only
    // subtype/configuration and silently flattened every branch and position.
    if (rule.nodes.length > 0) {
      await this.replaceNodes(
        copy.id,
        rule.nodes.map((node) => ({
          id: node.id,
          nodeType: node.nodeType,
          subtype: node.subtype,
          configuration: node.configuration as Record<string, unknown>,
          position: { x: node.positionX, y: node.positionY },
          parentId: node.parentNodeId,
          branchKey: node.branchKey,
          order: node.position,
        })),
      );
    }

    return this.get(workspaceId, projectId, copy.id);
  }

  /**
   * Archives a published rule, deletes a draft.
   *
   * A rule that has run is part of the record of why tasks look the way they
   * do — its executions reference it, and deleting it would take that history
   * with them. A draft has no history to lose.
   */
  async remove(workspaceId: string, projectId: string, role: WorkspaceRole, ruleId: string) {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    if (rule.runCount > 0 || rule.publishedAt) {
      await this.prisma.automationRule.update({
        where: { id: ruleId },
        data: { status: AutomationRuleStatus.ARCHIVED },
      });
      return { deleted: false, archived: true };
    }

    await this.prisma.automationRule.delete({ where: { id: ruleId } });
    return { deleted: true, archived: false };
  }

  /**
   * A rule's runs, newest first, a page at a time. The rows stay the data;
   * the page numbers ride in the envelope's `meta`, so a caller that read
   * the plain list before still reads the same first page.
   */
  async executions(workspaceId: string, projectId: string, ruleId: string, page: PageRequest) {
    await this.requireRule(workspaceId, projectId, ruleId);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationExecution.count({ where: { ruleId } }),
      this.prisma.automationExecution.findMany({
        where: { ruleId },
        include: {
          logs: { orderBy: { createdAt: 'asc' } },
          // Which version ran, so an old run reads against what the rule said then.
          ruleVersion: { select: { version: true } },
        },
        // The id breaks ties between runs that started in the same instant,
        // so a row cannot appear on two pages.
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(page),
      }),
    ]);

    return new PaginatedResult(items, buildPaginationMeta(page, total));
  }

  /**
   * "Run rule" — a manual rule, on the tasks somebody picked.
   *
   * Anyone who can edit the project's tasks may run one, as in Asana; changing
   * the rule stays a manager's job. Each task gets an event aimed at this rule
   * alone, credited to the person who ran it, so the run is logged, guarded
   * and chained exactly as one an edit sets off.
   */
  async runManually(
    workspaceId: string,
    projectId: string,
    ruleId: string,
    actor: ActorContext,
    taskIds: string[],
    timezone?: string,
  ): Promise<{ queued: number }> {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);

    // The trigger that counts is the one running, not the one in the draft.
    const running = rule.publishedVersionId
      ? await this.prisma.automationRuleVersion.findUnique({
          where: { id: rule.publishedVersionId },
          select: { triggerType: true },
        })
      : null;

    if ((running?.triggerType ?? rule.triggerType) !== AutomationTrigger.RUN_MANUALLY) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'This rule runs on its own trigger, not by hand.',
      );
    }
    if (rule.status !== AutomationRuleStatus.ACTIVE) {
      throw AppException.badRequest('BAD_REQUEST', 'Turn this rule on before running it.');
    }

    await this.access.assertEffectiveRole(projectId, actor, WorkspaceRole.MEMBER);

    const wanted = [...new Set(taskIds)];
    const tasks = await this.prisma.task.findMany({
      // In this project by home or by link.
      where: {
        id: { in: wanted },
        workspaceId,
        archivedAt: null,
        OR: [{ projectId }, { projectLinks: { some: { projectId } } }],
      },
      select: { id: true },
    });

    if (tasks.length !== wanted.length) {
      throw AppException.notFound(
        'RESOURCE_NOT_FOUND',
        'A task to run this rule on is not in this project.',
      );
    }

    // One id for the batch, so the history reads it as one run.
    const correlationId = randomUUID();

    for (const task of tasks) {
      await this.publisher.publish({
        workspaceId,
        projectId,
        trigger: AutomationTrigger.RUN_MANUALLY,
        entityType: 'TASK',
        entityId: task.id,
        actorId: actor.userId,
        ruleId: rule.id,
        correlationId,
        // Whose "today" the rule's text means, when it writes one.
        ...(isTimeZone(timezone) ? { after: { timezone } } : {}),
      });
    }

    return { queued: tasks.length };
  }

  // -------------------------------------------------------------------------

  private assertMayManage(role: WorkspaceRole): void {
    if (!hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only a workspace manager can change automations.');
    }
  }

  private async requireRule(workspaceId: string, projectId: string, ruleId: string) {
    const rule = await this.prisma.automationRule.findFirst({
      where: { id: ruleId, projectId, workspaceId },
      include: ruleInclude,
    });

    if (!rule) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Automation not found.');
    }

    return rule;
  }
}

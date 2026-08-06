import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  AutomationNodeType,
  AutomationRuleStatus,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AutomationRule, Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

import type { CreateRuleDto, UpdateRuleDto } from './dto/automation.dto';

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

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async list(workspaceId: string, projectId: string, sectionId?: string) {
    await this.projects.requireProject(workspaceId, projectId);

    return this.prisma.automationRule.findMany({
      where: {
        projectId,
        status: { not: AutomationRuleStatus.ARCHIVED },
        // Section scoping reads the trigger config rather than a column: the
        // section a rule watches is part of how it triggers, not a second
        // relationship that could drift out of step with it.
        ...(sectionId ? { triggerConfig: { path: ['sectionId'], equals: sectionId } } : {}),
      },
      include: ruleInclude,
      orderBy: { createdAt: 'desc' },
    });
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
   * The ids are kept because `parentNodeId` points at them: rewriting them on
   * every save would break every parent link in the same statement that wrote
   * it. Ids from the client are accepted only after being mapped through the
   * ones this call creates, so a caller cannot smuggle in a row it does not own.
   *
   * Two passes, because a parent may appear after its child in the array and a
   * self-referencing insert cannot resolve forward.
   */
  private async replaceNodes(ruleId: string, nodes: GraphNodeInput[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.automationNode.deleteMany({ where: { ruleId } });

      // Client ids are opaque strings — a new node has never been to the
      // database. Mapping them to real ones keeps `parentId` meaningful without
      // trusting anything the client says about identity.
      const realId = new Map<string, string>();
      // Only nodes that named themselves go in the map. One that did not came
      // from the old flat API, has no children, and needs no entry — nothing
      // will ever look it up.
      for (const node of nodes) {
        if (node.id) realId.set(node.id, randomUUID());
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
   */
  async publish(workspaceId: string, projectId: string, role: WorkspaceRole, ruleId: string) {
    const rule = await this.requireRule(workspaceId, projectId, ruleId);
    this.assertMayManage(role);

    const problems = await this.validate(rule);

    if (problems.length > 0) {
      throw AppException.badRequest('BAD_REQUEST', 'This rule is not ready to publish.', {
        problems,
      });
    }

    return this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { status: AutomationRuleStatus.ACTIVE, publishedAt: new Date() },
      include: ruleInclude,
    });
  }

  /** Everything wrong with a rule, so the builder can show all of it at once. */
  async validate(
    rule: AutomationRule & {
      nodes: { nodeType: string; subtype: string; configuration: unknown }[];
    },
  ): Promise<string[]> {
    const problems: string[] = [];

    if (!AUTOMATION_TRIGGERS.includes(rule.triggerType as never)) {
      problems.push('The trigger is not one this engine understands.');
    }

    const actions = rule.nodes.filter((node) => node.nodeType === AutomationNodeType.ACTION);

    if (actions.length === 0) {
      problems.push('Add at least one action — a rule with none would do nothing.');
    }

    for (const action of actions) {
      if (!AUTOMATION_ACTIONS.includes(action.subtype as never)) {
        problems.push(`"${action.subtype}" is not an action this engine can run.`);
      }
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
    return this.prisma.automationRule.create({
      data: {
        workspaceId,
        projectId,
        name: `${rule.name} copy`,
        description: rule.description,
        status: AutomationRuleStatus.DRAFT,
        triggerType: rule.triggerType,
        triggerConfig: rule.triggerConfig as Prisma.InputJsonValue,
        createdById: userId,
        nodes: {
          create: rule.nodes.map((node) => ({
            nodeType: node.nodeType,
            subtype: node.subtype,
            configuration: node.configuration as Prisma.InputJsonValue,
            position: node.position,
          })),
        },
      },
      include: ruleInclude,
    });
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

  async executions(workspaceId: string, projectId: string, ruleId: string, limit = 25) {
    await this.requireRule(workspaceId, projectId, ruleId);

    return this.prisma.automationExecution.findMany({
      where: { ruleId },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
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

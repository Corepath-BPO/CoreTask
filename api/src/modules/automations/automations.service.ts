import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  AutomationNodeType,
  AutomationRuleStatus,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { AutomationRule, Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

import type { CreateRuleDto, UpdateRuleDto } from './dto/automation.dto';

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
        ...(sectionId
          ? { triggerConfig: { path: ['sectionId'], equals: sectionId } }
          : {}),
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
    return this.prisma.automationRule.create({
      data: {
        workspaceId,
        projectId,
        name: dto.name,
        description: dto.description ?? null,
        status: AutomationRuleStatus.DRAFT,
        triggerType: dto.triggerType,
        triggerConfig: (dto.triggerConfig ?? {}) as Prisma.InputJsonValue,
        createdById: userId,
        nodes: {
          create: (dto.nodes ?? []).map((node, index) => ({
            nodeType: node.nodeType as AutomationNodeType,
            subtype: node.subtype,
            configuration: (node.configuration ?? {}) as Prisma.InputJsonValue,
            position: index,
          })),
        },
      },
      include: ruleInclude,
    });
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
      await this.prisma.$transaction([
        this.prisma.automationNode.deleteMany({ where: { ruleId } }),
        this.prisma.automationNode.createMany({
          data: dto.nodes.map((node, index) => ({
            ruleId,
            nodeType: node.nodeType as AutomationNodeType,
            subtype: node.subtype,
            configuration: (node.configuration ?? {}) as Prisma.InputJsonValue,
            position: index,
          })),
        }),
      ]);
      data.version = { increment: 1 };
    }

    return this.prisma.automationRule.update({
      where: { id: ruleId },
      data,
      include: ruleInclude,
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
    rule: AutomationRule & { nodes: { nodeType: string; subtype: string; configuration: unknown }[] },
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
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only a workspace manager can change automations.',
      );
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

import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  AutomationNodeType,
  ConditionValueKind,
  GraphIssueLevel,
} from '@coretask/contracts';
import type { AutomationGraphIssue, AutomationGraphValidation } from '@coretask/types';
import { validateCondition, validateGraphStructure } from '@coretask/validation';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../database/prisma.service';

/** The shape this validator needs, whether it came from the wire or the table. */
export interface ValidatableGraphNode {
  id: string;
  type: string;
  subtype: string;
  configuration: Record<string, unknown>;
  parentId: string | null;
  branchKey: string | null;
}

/**
 * Whether a rule is fit to publish.
 *
 * Two halves, deliberately kept apart. The structural half lives in
 * `@coretask/validation` and runs on both sides, so the builder can grey out
 * Publish for exactly the reasons the server would refuse — no round trip per
 * keystroke, and no chance of the two disagreeing about what "valid" means.
 *
 * This half is the part only the server can answer: whether the section still
 * exists, whether the member is still here, whether the status belongs to this
 * project. A browser cannot check any of it, and a rule that passes the form
 * and points at a deleted section is a rule that silently never fires.
 */
@Injectable()
export class AutomationGraphValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(
    projectId: string,
    workspaceId: string,
    name: string | null,
    nodes: readonly ValidatableGraphNode[],
  ): Promise<AutomationGraphValidation> {
    const issues: AutomationGraphIssue[] = [
      ...validateGraphStructure(nodes, name),
      ...this.checkSubtypes(nodes),
      ...(await this.checkReferences(projectId, workspaceId, nodes)),
      ...this.checkLoopRisk(nodes),
    ];

    return {
      publishable: !issues.some((issue) => issue.level === GraphIssueLevel.ERROR),
      issues,
    };
  }

  /** A trigger or action this engine has no code for cannot run, whatever it says. */
  private checkSubtypes(nodes: readonly ValidatableGraphNode[]): AutomationGraphIssue[] {
    const issues: AutomationGraphIssue[] = [];

    for (const node of nodes) {
      if (node.type === AutomationNodeType.TRIGGER) {
        if (!AUTOMATION_TRIGGERS.includes(node.subtype as never)) {
          issues.push({
            level: GraphIssueLevel.ERROR,
            nodeId: node.id,
            path: 'subtype',
            message: 'This is not a trigger the engine understands.',
          });
        }
      }

      if (node.type === AutomationNodeType.ACTION) {
        if (!AUTOMATION_ACTIONS.includes(node.subtype as never)) {
          issues.push({
            level: GraphIssueLevel.ERROR,
            nodeId: node.id,
            path: 'subtype',
            message: `“${node.subtype}” is not an action the engine can run.`,
          });
        }
      }

      /*
       * BRANCH and DELAY exist in the schema and the runner does not read them.
       * Refused rather than silently ignored: a published rule containing one
       * would look like it splits and would run straight through.
       */
      if (node.type === AutomationNodeType.BRANCH || node.type === AutomationNodeType.DELAY) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: null,
          message: 'This step type cannot run yet.',
        });
      }
    }

    return issues;
  }

  /**
   * Everything a rule points at has to still be here, and be here in *this*
   * project.
   *
   * The scoping matters as much as the existence: a rule that assigns somebody
   * from another workspace, or moves a task into another project's section, is
   * not a broken rule — it is a way of reaching across a tenant boundary.
   */
  private async checkReferences(
    projectId: string,
    workspaceId: string,
    nodes: readonly ValidatableGraphNode[],
  ): Promise<AutomationGraphIssue[]> {
    const issues: AutomationGraphIssue[] = [];

    const sectionIds = new Set<string>();
    const userIds = new Set<string>();
    const statusIds = new Set<string>();
    const fieldIds = new Set<string>();

    const read = (value: unknown): string | null =>
      typeof value === 'string' && value !== '' ? value : null;

    for (const node of nodes) {
      const config = node.configuration;

      const sectionId = read(config['sectionId']);
      if (sectionId) sectionIds.add(sectionId);

      const userId = read(config['userId']) ?? read(config['assigneeId']);
      if (userId) userIds.add(userId);

      const statusId = read(config['statusDefinitionId']);
      if (statusId) statusIds.add(statusId);

      const fieldId = read(config['customFieldId']);
      if (fieldId) fieldIds.add(fieldId);
    }

    const [sections, members, statuses, fields] = await Promise.all([
      sectionIds.size
        ? this.prisma.section.findMany({
            where: { id: { in: [...sectionIds] }, projectId },
            select: { id: true },
          })
        : [],
      userIds.size
        ? this.prisma.workspaceMember.findMany({
            where: { workspaceId, userId: { in: [...userIds] } },
            select: { userId: true },
          })
        : [],
      statusIds.size
        ? this.prisma.statusDefinition.findMany({
            where: {
              id: { in: [...statusIds] },
              workspaceId,
              OR: [{ projectId }, { projectId: null }],
            },
            select: { id: true },
          })
        : [],
      fieldIds.size
        ? this.prisma.customField.findMany({
            where: { id: { in: [...fieldIds] }, workspaceId, isArchived: false },
            select: { id: true },
          })
        : [],
    ]);

    const liveSections = new Set(sections.map((row) => row.id));
    const liveMembers = new Set(members.map((row) => row.userId));
    const liveStatuses = new Set(statuses.map((row) => row.id));
    const liveFields = new Set(fields.map((row) => row.id));

    for (const node of nodes) {
      const config = node.configuration;

      const sectionId = read(config['sectionId']);
      if (sectionId && !liveSections.has(sectionId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'sectionId',
          message: 'That section is no longer in this project.',
        });
      }

      const userId = read(config['userId']) ?? read(config['assigneeId']);
      if (userId && !liveMembers.has(userId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'userId',
          message: 'That person is no longer a member of this workspace.',
        });
      }

      const statusId = read(config['statusDefinitionId']);
      if (statusId && !liveStatuses.has(statusId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'statusDefinitionId',
          message: 'That status is not available in this project.',
        });
      }

      const fieldId = read(config['customFieldId']);
      if (fieldId && !liveFields.has(fieldId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'customFieldId',
          message: 'That field no longer exists.',
        });
      }

      if (node.type === AutomationNodeType.CONDITION) {
        issues.push(...validateCondition(config, this.valueKindOf(config['field']), node.id));
      }
    }

    return issues;
  }

  /**
   * What kind of value a condition field holds.
   *
   * Kept alongside the metadata service's list rather than derived from it, so
   * the two are read together — if a field is added there and not here, the
   * condition simply reports as unknown rather than validating against nothing.
   */
  private valueKindOf(field: unknown): ConditionValueKind | undefined {
    if (typeof field !== 'string') return undefined;

    const kinds: Record<string, ConditionValueKind> = {
      status: ConditionValueKind.ENUM,
      priority: ConditionValueKind.ENUM,
      sectionId: ConditionValueKind.REFERENCE,
      assigneeId: ConditionValueKind.REFERENCE,
      title: ConditionValueKind.TEXT,
      dueDate: ConditionValueKind.DATE,
      startDate: ConditionValueKind.DATE,
    };

    return kinds[field];
  }

  /**
   * A rule whose action re-fires its own trigger.
   *
   * Warned about rather than refused: "when status changes, set the status"
   * is occasionally what somebody means, and the runner already has depth
   * limits and correlation ids to stop it running away. Refusing outright would
   * block a legitimate rule to prevent a survivable one.
   */
  private checkLoopRisk(nodes: readonly ValidatableGraphNode[]): AutomationGraphIssue[] {
    const trigger = nodes.find((node) => node.type === AutomationNodeType.TRIGGER);
    if (!trigger) return [];

    const willRetrigger: Record<string, string[]> = {
      TASK_STATUS_CHANGED: ['UPDATE_STATUS'],
      TASK_PRIORITY_CHANGED: ['UPDATE_PRIORITY'],
      TASK_ASSIGNED: ['ASSIGN_USER'],
      TASK_MOVED_TO_SECTION: ['MOVE_TO_SECTION'],
      TASK_UPDATED: ['UPDATE_STATUS', 'UPDATE_PRIORITY', 'ASSIGN_USER', 'SET_DUE_DATE'],
    };

    const risky = willRetrigger[trigger.subtype] ?? [];

    return nodes
      .filter((node) => node.type === AutomationNodeType.ACTION && risky.includes(node.subtype))
      .map((node) => ({
        level: GraphIssueLevel.WARNING,
        nodeId: node.id,
        path: null,
        message: 'This action can set off the same trigger again.',
      }));
  }
}

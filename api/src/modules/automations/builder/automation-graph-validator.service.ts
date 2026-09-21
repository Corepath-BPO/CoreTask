import { TaskPriority, TaskStatus } from '@prisma/client';
import {
  isTokenValue,
  tokensForFieldType,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  AutomationAction,
  AutomationNodeType,
  GraphIssueLevel,
  isFallbackBranch,
  subtaskEntries,
  subtaskProblems,
  subtaskTitles,
} from '@coretask/contracts';
import type { AutomationGraphIssue, AutomationGraphValidation } from '@coretask/types';
import { validateCondition, validateGraphStructure } from '@coretask/validation';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/exceptions/app.exception';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../database/prisma.service';
import { assertDeliverableUrl } from '../../webhooks/lib/url-policy';

import {
  conditionFieldKind,
  customFieldConditionId,
  kindForCustomFieldType,
  triggerUnavailableReason,
} from './automation-catalogue';

/**
 * One node as the table holds it.
 *
 * The stored shape rather than the wire's, because the two disagree — the row
 * says `nodeType` and `parentNodeId`, the builder says `type` and `parentId` —
 * and something has to be the shape this reads. It is the row's, since publish
 * validates what is stored: whatever a request body claimed, the rule that goes
 * ACTIVE is the one in the table, and validating anything else would check a
 * graph nobody is about to run. The controller maps a body into this on its way
 * in; a row needs no mapping at all.
 *
 * `configuration` is `unknown` for the same reason: the column is JSON and can
 * hold anything, so it is narrowed here rather than asserted at every caller.
 */
export interface ValidatableGraphNode {
  id: string;
  nodeType: string;
  subtype: string;
  configuration: unknown;
  parentNodeId: string | null;
  branchKey: string | null;
  /** Where this sits among its siblings — what makes "the last row" a fact. */
  position?: number;
}

/**
 * The same node in the shape the shared structural check reads.
 *
 * Taken from that function's own parameter rather than written out again. It is
 * shared with the browser, which has no rows at all and speaks the canvas's
 * names for these fields, so this is the one place the two vocabularies meet —
 * and a second declaration of it here would be a second thing to keep in step.
 */
type StructuralNode = Parameters<typeof validateGraphStructure>[0][number];

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async validate(
    projectId: string,
    workspaceId: string,
    name: string | null,
    nodes: readonly ValidatableGraphNode[],
  ): Promise<AutomationGraphValidation> {
    // Mapped once, here, so every check below reads one shape — and so the
    // structural half gets exactly what the builder passes it.
    const graph = nodes.map(toStructural);

    const issues: AutomationGraphIssue[] = [
      ...validateGraphStructure(graph, name),
      ...this.checkSubtypes(graph),
      ...(await this.checkReferences(projectId, workspaceId, graph)),
      ...this.checkLoopRisk(graph),
    ];

    return {
      publishable: !issues.some((issue) => issue.level === GraphIssueLevel.ERROR),
      issues,
    };
  }

  /** A trigger or action this engine has no code for cannot run, whatever it says. */
  private checkSubtypes(nodes: readonly StructuralNode[]): AutomationGraphIssue[] {
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
        } else {
          const reason = triggerUnavailableReason(node.subtype);

          if (reason) {
            issues.push({
              level: GraphIssueLevel.ERROR,
              nodeId: node.id,
              path: 'subtype',
              message: reason,
            });
          }
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
        } else if (node.subtype === AutomationAction.CREATE_SUBTASK) {
          // A subtask step with nothing to create would publish cleanly and
          // fail on every run; the emptiness is checkable here, so it is an
          // error here rather than a message in the execution log. So is a
          // due date the runner could not turn into a day.
          if (subtaskTitles(node.configuration).length === 0) {
            issues.push({
              level: GraphIssueLevel.ERROR,
              nodeId: node.id,
              path: 'configuration',
              message: 'Give this step at least one subtask title.',
            });
          }

          for (const problem of subtaskProblems(node.configuration)) {
            issues.push({
              level: GraphIssueLevel.ERROR,
              nodeId: node.id,
              path: 'subtasks',
              message: problem.message,
            });
          }
        }
      }

      /*
       * DELAY is in the schema and nothing executes it. Refused rather than
       * silently ignored: a published rule containing one would look like it
       * waits and would run straight through.
       *
       * BRANCH used to be refused for the same reason and no longer is — the
       * runner walks the tree and takes one arm. See the branching document.
       */
      if (node.type === AutomationNodeType.DELAY) {
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
    nodes: readonly StructuralNode[],
  ): Promise<AutomationGraphIssue[]> {
    const issues: AutomationGraphIssue[] = [];

    const sectionIds = new Set<string>();
    const userIds = new Set<string>();
    const statusIds = new Set<string>();
    const priorityIds = new Set<string>();
    const fieldIds = new Set<string>();
    const targetProjectIds = new Set<string>();
    const targetSectionIds = new Set<string>();
    const webhookEndpointIds = new Set<string>();

    const read = (value: unknown): string | null =>
      typeof value === 'string' && value !== '' ? value : null;

    for (const node of nodes) {
      const config = node.configuration;

      const sectionId = read(config['sectionId']);
      if (sectionId) sectionIds.add(sectionId);

      // A move out of this project names another project and, optionally, a
      // section of *that* one — under its own key, so the `sectionId` check
      // above never mistakes it for a section that should be here.
      if (node.subtype === AutomationAction.MOVE_TO_PROJECT) {
        const targetProjectId = read(config['projectId']);
        if (targetProjectId) targetProjectIds.add(targetProjectId);

        const targetSectionId = read(config['targetSectionId']);
        if (targetSectionId) targetSectionIds.add(targetSectionId);
      }

      const userId = read(config['userId']) ?? read(config['assigneeId']);
      if (userId) userIds.add(userId);

      // The person each subtask goes to is a reference like the assign
      // action's, and is looked up in the same query.
      if (node.subtype === AutomationAction.CREATE_SUBTASK) {
        for (const entry of subtaskEntries(config)) {
          if (entry.assigneeId) userIds.add(entry.assigneeId);
        }
      }

      // A webhook step names a workspace endpoint; a rule may not send to
      // another workspace's, so the lookup is scoped like every other.
      if (node.subtype === AutomationAction.SEND_WEBHOOK) {
        const endpointId = read(config['endpointId']);
        if (endpointId) webhookEndpointIds.add(endpointId);
      }

      /*
       * Canonical name first, then the one it used to be written under.
       *
       * This checked only the long names while the runner read only the short
       * ones, so it was validating a key nothing executed — a rule could pass
       * here with a status that does not exist and fail silently at run time,
       * which is the opposite of what a validator is for.
       *
       * A legacy enum name is not a definition id and has nothing to look up,
       * so it is skipped rather than reported as a missing definition.
       */
      const statusId = read(config['status'] ?? config['statusDefinitionId']);
      if (statusId && !(statusId in TaskStatus)) statusIds.add(statusId);

      const priorityId = read(config['priority'] ?? config['priorityDefinitionId']);
      if (priorityId && !(priorityId in TaskPriority)) priorityIds.add(priorityId);

      const fieldId = read(config['fieldId'] ?? config['customFieldId']);
      if (fieldId) fieldIds.add(fieldId);

      // A condition about a custom field carries the id inside its field key
      // rather than under `fieldId`; its type decides which comparisons fit.
      const conditionFieldId = customFieldConditionId(config['field']);
      if (conditionFieldId) fieldIds.add(conditionFieldId);
    }

    const [
      sections,
      members,
      statuses,
      priorities,
      fields,
      targetProjects,
      targetSections,
      webhookEndpoints,
    ] = await Promise.all([
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
      priorityIds.size
        ? // Priorities are workspace-wide; unlike statuses, a project cannot
          // define its own, so there is no project arm to check.
          this.prisma.priorityDefinition.findMany({
            where: { id: { in: [...priorityIds] }, workspaceId },
            select: { id: true },
          })
        : [],
      fieldIds.size
        ? this.prisma.customField.findMany({
            where: { id: { in: [...fieldIds] }, workspaceId, isArchived: false },
            // The type as well as the id: a computed value is only meaningful
            // on some of them, and this is where that is refused.
            select: { id: true, type: true },
          })
        : [],
      targetProjectIds.size
        ? // Another live project of this workspace. The rule's own is not a
          // destination, and an archived one would land the task somewhere
          // nobody looks.
          this.prisma.project.findMany({
            where: {
              id: { in: [...targetProjectIds] },
              workspaceId,
              archivedAt: null,
              NOT: { id: projectId },
            },
            select: { id: true },
          })
        : [],
      targetSectionIds.size
        ? // With the project each belongs to: the check below is that it is
          // the project the same node chose, not merely that it exists.
          this.prisma.section.findMany({
            where: { id: { in: [...targetSectionIds] }, workspaceId },
            select: { id: true, projectId: true },
          })
        : [],
      webhookEndpointIds.size
        ? this.prisma.webhookEndpoint.findMany({
            where: { id: { in: [...webhookEndpointIds] }, workspaceId },
            select: { id: true, enabled: true },
          })
        : [],
    ]);

    const liveEndpoints = new Map(webhookEndpoints.map((row) => [row.id, row.enabled]));
    const liveTargetProjects = new Set(targetProjects.map((row) => row.id));
    const targetSectionProject = new Map(targetSections.map((row) => [row.id, row.projectId]));

    const liveSections = new Set(sections.map((row) => row.id));
    const liveMembers = new Set(members.map((row) => row.userId));
    const liveStatuses = new Set(statuses.map((row) => row.id));
    const livePriorities = new Set(priorities.map((row) => row.id));
    const liveFields = new Set(fields.map((row) => row.id));
    const fieldType = new Map(fields.map((row) => [row.id, row.type as string]));

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

      if (node.subtype === AutomationAction.MOVE_TO_PROJECT) {
        const targetProjectId = read(config['projectId']);
        if (targetProjectId && !liveTargetProjects.has(targetProjectId)) {
          issues.push({
            level: GraphIssueLevel.ERROR,
            nodeId: node.id,
            path: 'projectId',
            message:
              targetProjectId === projectId
                ? 'The task is already in this project — choose another one.'
                : 'That project is no longer in this workspace.',
          });
        }

        const targetSectionId = read(config['targetSectionId']);
        if (
          targetSectionId &&
          (!targetSectionProject.has(targetSectionId) ||
            (targetProjectId !== null &&
              targetSectionProject.get(targetSectionId) !== targetProjectId))
        ) {
          issues.push({
            level: GraphIssueLevel.ERROR,
            nodeId: node.id,
            path: 'targetSectionId',
            message: 'That section is no longer in the chosen project.',
          });
        }
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

      if (node.subtype === AutomationAction.CREATE_SUBTASK) {
        subtaskEntries(config).forEach((entry, index) => {
          if (entry.assigneeId && !liveMembers.has(entry.assigneeId)) {
            issues.push({
              level: GraphIssueLevel.ERROR,
              nodeId: node.id,
              path: `subtasks.${index}.assigneeId`,
              message: 'That person is no longer a member of this workspace.',
            });
          }
        });
      }

      const statusId = read(config['status'] ?? config['statusDefinitionId']);
      if (statusId && !(statusId in TaskStatus) && !liveStatuses.has(statusId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'statusDefinitionId',
          message: 'That status is not available in this project.',
        });
      }

      const priorityId = read(config['priority'] ?? config['priorityDefinitionId']);
      if (priorityId && !(priorityId in TaskPriority) && !livePriorities.has(priorityId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'priority',
          message: 'That priority is not available in this project.',
        });
      }

      const fieldId = read(config['fieldId'] ?? config['customFieldId']);
      if (fieldId && !liveFields.has(fieldId)) {
        issues.push({
          level: GraphIssueLevel.ERROR,
          nodeId: node.id,
          path: 'customFieldId',
          message: 'That field no longer exists.',
        });
      }

      /*
       * Where a webhook step sends. An endpoint that is gone is an error; one
       * that is switched off is a warning, since switching it back on needs
       * no change to the rule. An ad-hoc URL is held to the same address
       * policy the settings page applies, in the deployment's own words.
       */
      if (node.subtype === AutomationAction.SEND_WEBHOOK) {
        const endpointId = read(config['endpointId']);
        if (endpointId) {
          const enabled = liveEndpoints.get(endpointId);
          if (enabled === undefined) {
            issues.push({
              level: GraphIssueLevel.ERROR,
              nodeId: node.id,
              path: 'endpointId',
              message: 'That webhook endpoint is no longer in this workspace.',
            });
          } else if (!enabled) {
            issues.push({
              level: GraphIssueLevel.WARNING,
              nodeId: node.id,
              path: 'endpointId',
              message:
                'That webhook endpoint is disabled, so this step sends nothing until it is enabled.',
            });
          }
        }

        const url = read(config['url']);
        if (url && !endpointId) {
          try {
            assertDeliverableUrl(url, { allowPrivate: this.config.webhooks.allowPrivateUrls });
          } catch (error) {
            issues.push({
              level: GraphIssueLevel.ERROR,
              nodeId: node.id,
              path: 'url',
              message:
                error instanceof AppException ? error.message : 'That URL cannot be sent to.',
            });
          }
        }
      }

      /*
       * A computed value, on a field that can hold one.
       *
       * The panel only offers "the date this rule is triggered" for a date, so
       * this is the endpoint agreeing rather than a second opinion — a form is
       * not a check, and a token posted onto a text field would otherwise be
       * stored, published, and only discovered when the action failed at run
       * time. Refused with the field's own type in the sentence, because "not
       * allowed here" without saying where it is allowed sends somebody
       * guessing.
       */
      if (fieldId && isTokenValue(config['value'])) {
        const type = fieldType.get(fieldId);

        if (type && tokensForFieldType(type).length === 0) {
          issues.push({
            level: GraphIssueLevel.ERROR,
            nodeId: node.id,
            path: 'value',
            message: 'A date the rule works out can only be set on a date field.',
          });
        }
      }

      /*
       * Every condition but the fallback, which is defined by asking nothing.
       *
       * Checking it would report a missing field on the one row that must never
       * have one — so a rule with an "otherwise" would be refused for being
       * exactly what somebody built.
       */
      if (node.type === AutomationNodeType.CONDITION && !isFallbackBranch(config)) {
        /*
         * A generated key's kind comes from the field's own type — and from
         * the *live* field, so a condition about a deleted one falls to
         * `undefined` and the shared check refuses it as no longer available,
         * which is exactly what happened to it.
         */
        const conditionFieldId = customFieldConditionId(config['field']);
        const kind = conditionFieldId
          ? kindForCustomFieldType(
              liveFields.has(conditionFieldId) ? fieldType.get(conditionFieldId) : undefined,
            )
          : conditionFieldKind(config['field']);

        issues.push(...validateCondition(config, kind, node.id));
      }
    }

    return issues;
  }

  /**
   * A rule whose action re-fires its own trigger.
   *
   * Warned about rather than refused: "when status changes, set the status"
   * is occasionally what somebody means, and the runner already has depth
   * limits and correlation ids to stop it running away. Refusing outright would
   * block a legitimate rule to prevent a survivable one.
   */
  private checkLoopRisk(nodes: readonly StructuralNode[]): AutomationGraphIssue[] {
    const trigger = nodes.find((node) => node.type === AutomationNodeType.TRIGGER);
    if (!trigger) return [];

    const willRetrigger: Record<string, string[]> = {
      TASK_STATUS_CHANGED: ['UPDATE_STATUS'],
      TASK_PRIORITY_CHANGED: ['UPDATE_PRIORITY'],
      TASK_ASSIGNED: ['ASSIGN_USER'],
      TASK_MOVED_TO_SECTION: ['MOVE_TO_SECTION'],
      TASK_UPDATED: [
        'UPDATE_STATUS',
        'UPDATE_PRIORITY',
        'ASSIGN_USER',
        'UNASSIGN_USER',
        'SET_DUE_DATE',
        'CLEAR_DUE_DATE',
        'SET_START_DATE',
        'CLEAR_START_DATE',
        'SET_ESTIMATE',
      ],
      TASK_DUE_DATE_CHANGED: ['SET_DUE_DATE', 'CLEAR_DUE_DATE'],
      TASK_START_DATE_CHANGED: ['SET_START_DATE', 'CLEAR_START_DATE'],
      TASK_ESTIMATE_CHANGED: ['SET_ESTIMATE'],
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

/** A stored node in the shape every check above reads. */
function toStructural(node: ValidatableGraphNode): StructuralNode {
  return {
    id: node.id,
    type: node.nodeType,
    subtype: node.subtype,
    configuration: asConfiguration(node.configuration),
    parentId: node.parentNodeId,
    branchKey: node.branchKey,
    // The column is `position` and the wire calls it `order`; either way the
    // checks need it, because "the last branch" is a fact about this number
    // rather than about the order rows came back in.
    order: node.position,
  };
}

/**
 * The JSON column as an object, whatever it actually holds.
 *
 * A configuration is written as an object everywhere, but the column is JSON
 * and a row from an older client — or from a hand-run migration — may hold a
 * string, an array or null. Reading a key off one of those would throw here and
 * fail a publish with a stack trace instead of the reason it was refused, so
 * anything that is not a plain object is read as an empty configuration and
 * reported by the checks that notice what is missing from it.
 */
function asConfiguration(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  return value as Record<string, unknown>;
}

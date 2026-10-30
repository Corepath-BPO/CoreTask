import {
  BlueprintPart,
  MAX_BLUEPRINT_TASKS,
  POSITION_STEP,
  WorkspaceRole,
  hasAtLeastRole,
  type ProjectVisibility,
} from '@coretask/contracts';
import type { StartedProject } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import {
  AutomationRuleStatus,
  TaskStatus,
  type ApprovalStatus,
  type Prisma,
  type ProjectMemberRole,
  type TaskKind,
  type TaskPriority,
} from '@prisma/client';

import type { ActorContext } from '../../common/types/api.types';
import { initialPositions } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { AutomationsService } from '../automations/automations.service';
import {
  AutomationTemplatesService,
  type RuleSnapshot,
} from '../automations/library/automation-templates.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { assignableIds } from '../project-access/assignable';
import { ProjectAccessService } from '../project-access/project-access.service';
import { ProjectsService } from '../projects/projects.service';

const DAY_MS = 86_400_000;

/** A custom field value as a blueprint carries it — the value columns, no ids. */
interface BlueprintValue {
  fieldId: string;
  textValue: string | null;
  numberValue: string | null;
  dateValue: string | null;
  booleanValue: boolean | null;
  optionIds: string[];
  userIds: string[];
}

/** One task in a blueprint. Dates are days from the blueprint's anchor. */
export interface BlueprintTask {
  title: string;
  description: string | null;
  /** Index into the blueprint's sections; null for a sectionless task or a subtask. */
  section: number | null;
  kind: TaskKind;
  status: TaskStatus;
  statusDefinitionId: string | null;
  priority: TaskPriority;
  priorityDefinitionId: string | null;
  assigneeId: string | null;
  estimatedMinutes: number | null;
  recurrence: Prisma.JsonValue | null;
  startOffset: number | null;
  dueOffset: number | null;
  values: BlueprintValue[];
  subtasks: BlueprintTask[];
}

/** A task template as a blueprint carries it. */
interface BlueprintTaskTemplate {
  name: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  priority: TaskPriority | null;
  assigneeId: string | null;
  dueInDays: number | null;
  subtasks: Prisma.JsonValue;
}

/** A project, as much of it as the chosen parts carry. */
export interface Blueprint {
  description: string | null;
  color: string;
  defaultWorkItemType: string;
  sections: string[];
  fieldIds: string[];
  rules: RuleSnapshot[];
  taskTemplates: BlueprintTaskTemplate[];
  tasks: BlueprintTask[];
  members: { userId: string; role: ProjectMemberRole }[];
}

/** How a new project starts from a blueprint. */
export interface StartOptions {
  name: string;
  startDate: Date;
  visibility?: ProjectVisibility;
  teamId?: string | null;
  /** A template's tasks start open; a duplicate keeps where each task was. */
  keepProgress: boolean;
}

/** The calendar day of an instant, as UTC midnight milliseconds. */
const dayOf = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * Blueprints — the engine under project templates and "Duplicate project".
 *
 * Taking one reads a project's sections and the chosen parts of the rest:
 * fields, rules (as the rule library snapshots them, so their sections can be
 * matched by name in the new project), task templates, members, and tasks
 * with their subtasks, assignees, field values and dates — dates kept as days
 * from the project's start, so a new project can count them from its own.
 *
 * Starting a project from one creates it the ordinary way, swaps the default
 * columns for the blueprint's, and writes the rest directly — no notification
 * per copied task, no rule firing for each one landing — then publishes the
 * rules that were live, where they validate in their new home.
 */
@Injectable()
export class ProjectBlueprintService {
  private readonly logger = new Logger(ProjectBlueprintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly access: ProjectAccessService,
    private readonly customFields: CustomFieldsService,
    private readonly automations: AutomationsService,
    private readonly ruleLibrary: AutomationTemplatesService,
  ) {}

  async take(
    workspaceId: string,
    projectId: string,
    parts: readonly BlueprintPart[],
  ): Promise<Blueprint> {
    const has = (part: BlueprintPart) => parts.includes(part);

    const project = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, workspaceId },
      select: { description: true, color: true, defaultWorkItemType: true, startDate: true },
    });

    const sections = await this.prisma.section.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    });
    const sectionIndex = new Map(sections.map((section, index) => [section.id, index]));

    const [fields, rules, taskTemplates, members, tasks] = await Promise.all([
      has(BlueprintPart.FIELDS)
        ? this.prisma.projectCustomField.findMany({
            where: { projectId, customField: { isArchived: false } },
            orderBy: { position: 'asc' },
            select: { customFieldId: true },
          })
        : [],
      has(BlueprintPart.RULES)
        ? this.prisma.automationRule.findMany({
            where: { projectId, status: { not: AutomationRuleStatus.ARCHIVED } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, _count: { select: { nodes: true } } },
          })
        : [],
      has(BlueprintPart.TASK_TEMPLATES)
        ? this.prisma.taskTemplate.findMany({ where: { projectId }, orderBy: { name: 'asc' } })
        : [],
      has(BlueprintPart.MEMBERS)
        ? this.prisma.projectMember.findMany({
            where: { projectId },
            select: { userId: true, role: true },
          })
        : [],
      has(BlueprintPart.TASKS)
        ? this.prisma.task.findMany({
            where: { projectId, parentTaskId: null, parentTicketId: null, archivedAt: null },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            take: MAX_BLUEPRINT_TASKS,
            include: {
              customFieldValues: true,
              subtasks: {
                where: { archivedAt: null },
                orderBy: [{ position: 'asc' }, { id: 'asc' }],
                include: { customFieldValues: true },
              },
            },
          })
        : [],
    ]);

    const fieldIds = fields.map((field) => field.customFieldId);
    const fieldSet = new Set(fieldIds);

    // Dates count from the project's start, or else its earliest task date.
    const dated = tasks.flatMap((task) => [task.startDate, task.dueDate]).filter(Boolean) as Date[];
    const anchor = project.startDate
      ? dayOf(project.startDate)
      : dated.length > 0
        ? Math.min(...dated.map(dayOf))
        : dayOf(new Date());
    const offset = (date: Date | null) =>
      has(BlueprintPart.DATES) && date ? Math.round((dayOf(date) - anchor) / DAY_MS) : null;

    type TaskRow = (typeof tasks)[number] | (typeof tasks)[number]['subtasks'][number];
    const toBlueprintTask = (task: TaskRow, subtasks: BlueprintTask[]): BlueprintTask => ({
      title: task.title,
      description: task.description,
      section: task.parentTaskId ? null : (sectionIndex.get(task.sectionId ?? '') ?? null),
      kind: task.kind,
      status: task.status,
      statusDefinitionId: task.statusDefinitionId,
      priority: task.priority,
      priorityDefinitionId: task.priorityDefinitionId,
      assigneeId: has(BlueprintPart.ASSIGNEES) ? task.assigneeId : null,
      estimatedMinutes: task.estimatedMinutes,
      recurrence: task.recurrence,
      startOffset: offset(task.startDate),
      dueOffset: offset(task.dueDate),
      // Only the values of fields the blueprint brings along.
      values: task.customFieldValues
        .filter((value) => fieldSet.has(value.customFieldId))
        .map((value) => ({
          fieldId: value.customFieldId,
          textValue: value.textValue,
          numberValue: value.numberValue === null ? null : value.numberValue.toString(),
          dateValue: value.dateValue?.toISOString() ?? null,
          booleanValue: value.booleanValue,
          optionIds: value.optionIds,
          userIds: value.userIds,
        })),
      subtasks,
    });

    const snapshots: RuleSnapshot[] = [];
    for (const rule of rules) {
      if (rule._count.nodes === 0) continue;
      snapshots.push(await this.ruleLibrary.snapshotRule(workspaceId, projectId, rule.id));
    }

    return {
      description: project.description,
      color: project.color,
      defaultWorkItemType: project.defaultWorkItemType,
      sections: sections.map((section) => section.name),
      fieldIds,
      rules: snapshots,
      taskTemplates: taskTemplates.map((template) => ({
        name: template.name,
        title: template.title,
        description: template.description,
        kind: template.kind,
        priority: template.priority,
        assigneeId: has(BlueprintPart.ASSIGNEES) ? template.assigneeId : null,
        dueInDays: template.dueInDays,
        subtasks: template.subtasks,
      })),
      tasks: tasks.map((task) =>
        toBlueprintTask(
          task,
          has(BlueprintPart.SUBTASKS)
            ? task.subtasks.map((subtask) => toBlueprintTask(subtask, []))
            : [],
        ),
      ),
      members: members.map((member) => ({ userId: member.userId, role: member.role })),
    };
  }

  /** A new project, built from the blueprint. */
  async start(
    workspaceId: string,
    actor: ActorContext,
    blueprint: Blueprint,
    options: StartOptions,
  ): Promise<StartedProject> {
    const created = await this.projects.create(workspaceId, actor, {
      name: options.name,
      ...(blueprint.description ? { description: blueprint.description } : {}),
      color: blueprint.color,
      ...(blueprint.defaultWorkItemType === 'TICKET'
        ? { defaultWorkItemType: 'TICKET' as const }
        : {}),
      ...(options.visibility ? { visibility: options.visibility } : {}),
      ...(options.teamId ? { teamId: options.teamId } : {}),
      startDate: new Date(options.startDate).toISOString().slice(0, 10),
    });
    const projectId = created.id;

    // The blueprint's columns in place of the defaults.
    const sectionIds = await this.replaceSections(workspaceId, projectId, blueprint.sections);

    const access = await this.access.requireAccess(workspaceId, projectId, actor);
    const role = access.effectiveRole;

    for (const fieldId of blueprint.fieldIds) {
      try {
        await this.customFields.attach(workspaceId, projectId, actor.userId, role, fieldId);
      } catch (error) {
        // Archived or deleted since; the rest still come.
        this.logger.warn({ err: error, projectId, fieldId }, 'Blueprint field not attached');
      }
    }

    // The people who are still in the workspace.
    const members = new Set(
      (
        await this.prisma.workspaceMember.findMany({
          where: { workspaceId, deactivatedAt: null },
          select: { userId: true },
        })
      ).map((row) => row.userId),
    );
    if (blueprint.members.length > 0) {
      await this.prisma.projectMember.createMany({
        data: blueprint.members
          .filter((member) => members.has(member.userId))
          .map((member) => ({
            projectId,
            workspaceId,
            userId: member.userId,
            role: member.role,
            addedById: actor.userId,
          })),
        skipDuplicates: true,
      });
    }

    const person = (id: string | null) => (id && members.has(id) ? id : null);
    // Work here goes only to the new project's members and the owner, as
    // anywhere else: assignees brought without their membership are left
    // off. A people field may still name anyone in the workspace.
    const assignable = await assignableIds(this.prisma, workspaceId, [projectId]);
    const assignee = (id: string | null) => {
      const kept = person(id);
      return kept && (assignable?.has(kept) ?? true) ? kept : null;
    };

    if (blueprint.taskTemplates.length > 0) {
      await this.prisma.taskTemplate.createMany({
        data: blueprint.taskTemplates.map((template) => ({
          workspaceId,
          projectId,
          createdById: actor.userId,
          name: template.name,
          title: template.title,
          description: template.description,
          kind: template.kind,
          priority: template.priority,
          assigneeId: assignee(template.assigneeId),
          dueInDays: template.dueInDays,
          subtasks: (template.subtasks ?? []) as Prisma.InputJsonValue,
        })),
      });
    }

    await this.writeTasks(workspaceId, projectId, actor, blueprint, sectionIds, options, {
      person,
      assignee,
    });

    // Rules last, so their sections and fields can be matched by name.
    const result: StartedProject = { projectId, rulesNeedingAttention: [], rulesSkipped: 0 };
    if (!hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      result.rulesSkipped = blueprint.rules.length;
      return result;
    }
    for (const snapshot of blueprint.rules) {
      const written = await this.ruleLibrary.writeSnapshot(
        workspaceId,
        projectId,
        actor.userId,
        role,
        snapshot,
      );
      if (!snapshot.live) continue;
      if (written.unresolved.length > 0) {
        result.rulesNeedingAttention.push(snapshot.name);
        continue;
      }
      try {
        await this.automations.publish(workspaceId, projectId, role, written.ruleId, actor.userId);
      } catch {
        result.rulesNeedingAttention.push(snapshot.name);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------

  /** Sections named in order; the project's defaults when the blueprint names none. */
  private async replaceSections(
    workspaceId: string,
    projectId: string,
    names: readonly string[],
  ): Promise<string[]> {
    if (names.length === 0) {
      const existing = await this.prisma.section.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      return existing.map((section) => section.id);
    }

    const positions = initialPositions(names.length);
    return this.prisma.$transaction(async (tx) => {
      await tx.section.deleteMany({ where: { projectId } });
      const ids: string[] = [];
      for (const [index, name] of names.entries()) {
        const section = await tx.section.create({
          data: { workspaceId, projectId, name, position: positions[index] as number },
          select: { id: true },
        });
        ids.push(section.id);
      }
      return ids;
    });
  }

  private async writeTasks(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    blueprint: Blueprint,
    sectionIds: readonly string[],
    options: StartOptions,
    people: {
      /** Someone still in the workspace, for a people field. */
      person: (id: string | null) => string | null;
      /** Someone work in the new project may go to, for an assignee. */
      assignee: (id: string | null) => string | null;
    },
  ): Promise<void> {
    const { person, assignee } = people;
    if (blueprint.tasks.length === 0) return;

    // Workspace-wide statuses travel; a status the old project defined for
    // itself does not exist here, so the task falls back to its plain state.
    const statusIds = [
      ...new Set(
        blueprint.tasks
          .flatMap((task) => [task, ...task.subtasks])
          .map((task) => task.statusDefinitionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const portable = new Set(
      (
        await this.prisma.statusDefinition.findMany({
          where: { id: { in: statusIds }, projectId: null },
          select: { id: true },
        })
      ).map((row) => row.id),
    );

    const start = dayOf(options.startDate);
    const day = (offset: number | null) =>
      offset === null ? null : new Date(start + offset * DAY_MS);
    const nextPosition = new Map<string, number>();
    const positionIn = (key: string) => {
      const position = (nextPosition.get(key) ?? 0) + POSITION_STEP;
      nextPosition.set(key, position);
      return position;
    };

    const write = async (task: BlueprintTask, parentTaskId: string | null) => {
      const sectionId = parentTaskId
        ? null
        : task.section === null
          ? null
          : (sectionIds[task.section] ?? sectionIds[0] ?? null);
      const keepState = options.keepProgress;
      const done = keepState && task.status === TaskStatus.DONE;

      const created = await this.prisma.task.create({
        data: {
          workspaceId,
          projectId,
          sectionId,
          parentTaskId,
          title: task.title,
          description: task.description,
          kind: task.kind,
          approvalStatus: task.kind === 'APPROVAL' ? ('PENDING' as ApprovalStatus) : null,
          status: keepState ? task.status : TaskStatus.TODO,
          statusDefinitionId:
            keepState && task.statusDefinitionId && portable.has(task.statusDefinitionId)
              ? task.statusDefinitionId
              : null,
          completedAt: done ? new Date() : null,
          priority: task.priority,
          priorityDefinitionId: task.priorityDefinitionId,
          assigneeId: assignee(task.assigneeId),
          estimatedMinutes: task.estimatedMinutes,
          ...(task.recurrence ? { recurrence: task.recurrence as Prisma.InputJsonValue } : {}),
          startDate: day(task.startOffset),
          dueDate: day(task.dueOffset),
          position: positionIn(parentTaskId ?? sectionId ?? 'none'),
          createdById: actor.userId,
        },
        select: { id: true },
      });

      if (task.values.length > 0) {
        await this.prisma.taskCustomFieldValue.createMany({
          data: task.values.map((value) => ({
            taskId: created.id,
            customFieldId: value.fieldId,
            textValue: value.textValue,
            numberValue: value.numberValue,
            dateValue: value.dateValue ? new Date(value.dateValue) : null,
            booleanValue: value.booleanValue,
            optionIds: value.optionIds,
            userIds: value.userIds.filter((id) => person(id) !== null),
            updatedById: actor.userId,
          })),
          skipDuplicates: true,
        });
      }

      for (const subtask of task.subtasks) await write(subtask, created.id);
    };

    for (const task of blueprint.tasks) await write(task, null);
  }
}

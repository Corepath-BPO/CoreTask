import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AUTOMATION_SELECTOR_CATEGORY,
  AUTOMATION_TRIGGERS,
  AutomationAction,
  AutomationTrigger,
  ConditionValueKind,
  TASK_PRIORITIES,
  TASK_PRIORITY_DISPLAY,
  TASK_STATUS_DISPLAY,
  TASK_STATUSES,
  TRIGGER_LABEL,
} from '@coretask/contracts';
import type {
  AutomationCatalogEntry,
  AutomationMetadata,
  ConditionFieldDefinition,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../database/prisma.service';
import { ProjectsService } from '../../projects/projects.service';

/**
 * Everything the builder's forms need to offer real choices.
 *
 * The old builder hard-coded its condition fields and read sections from
 * whatever the page happened to have. That meant a form could offer a status a
 * project does not define, and a workspace that renamed its statuses saw
 * somebody else's words. One endpoint, answered from the project.
 */
@Injectable()
export class AutomationMetadataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async forProject(workspaceId: string, projectId: string): Promise<AutomationMetadata> {
    await this.projects.requireProject(workspaceId, projectId);

    const [sections, statuses, priorities, members, customFields] = await Promise.all([
      this.prisma.section.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.statusDefinition.findMany({
        where: { workspaceId, OR: [{ projectId }, { projectId: null }] },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, colorToken: true },
      }),
      this.prisma.priorityDefinition.findMany({
        where: { workspaceId },
        orderBy: { level: 'asc' },
        select: { id: true, name: true, colorToken: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      }),
      this.prisma.customField.findMany({
        where: { workspaceId, isArchived: false, projects: { some: { projectId } } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true },
      }),
    ]);

    return {
      triggers: this.triggers(),
      actions: this.actions(),
      conditionFields: this.conditionFields(statuses, priorities, sections, members),
      sections,
      statuses,
      priorities,
      members: members.map((row) => row.user),
      customFields,
    };
  }

  /**
   * Every declared trigger, with whether it can actually run.
   *
   * Listed rather than filtered: an unavailable trigger shown disabled says
   * "not yet", and one simply missing says "never considered". The engine's own
   * list is the source of truth for `available`, so a trigger cannot appear
   * usable here and be refused on publish.
   */
  private triggers(): AutomationCatalogEntry[] {
    return AUTOMATION_TRIGGERS.map((subtype) => ({
      subtype,
      label: TRIGGER_LABEL[subtype],
      description: TRIGGER_LABEL[subtype],
      category: this.triggerCategory(subtype),
      available: true,
    }));
  }

  private actions(): AutomationCatalogEntry[] {
    return AUTOMATION_ACTIONS.map((subtype) => ({
      subtype,
      label: ACTION_LABEL[subtype],
      description: ACTION_LABEL[subtype],
      category: this.actionCategory(subtype),
      available: true,
    }));
  }

  private triggerCategory(trigger: AutomationTrigger): string {
    if (trigger === AutomationTrigger.COMMENT_ADDED) {
      return AUTOMATION_SELECTOR_CATEGORY.COMMUNICATION;
    }
    if (trigger === AutomationTrigger.TASK_ASSIGNED) {
      return AUTOMATION_SELECTOR_CATEGORY.ASSIGNMENT;
    }
    if (trigger === AutomationTrigger.CUSTOM_FIELD_CHANGED) {
      return AUTOMATION_SELECTOR_CATEGORY.FIELDS;
    }
    if (
      trigger === AutomationTrigger.TASK_STATUS_CHANGED ||
      trigger === AutomationTrigger.TASK_PRIORITY_CHANGED ||
      trigger === AutomationTrigger.TASK_MOVED_TO_SECTION ||
      trigger === AutomationTrigger.TASK_COMPLETED
    ) {
      return AUTOMATION_SELECTOR_CATEGORY.WORKFLOW;
    }

    return AUTOMATION_SELECTOR_CATEGORY.WORK_ITEM;
  }

  private actionCategory(action: AutomationAction): string {
    const byAction: Partial<Record<AutomationAction, string>> = {
      ASSIGN_USER: AUTOMATION_SELECTOR_CATEGORY.ASSIGNMENT,
      UNASSIGN_USER: AUTOMATION_SELECTOR_CATEGORY.ASSIGNMENT,
      MOVE_TO_SECTION: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
      UPDATE_STATUS: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
      UPDATE_PRIORITY: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
      SET_DUE_DATE: AUTOMATION_SELECTOR_CATEGORY.DATES,
      CLEAR_DUE_DATE: AUTOMATION_SELECTOR_CATEGORY.DATES,
      SET_CUSTOM_FIELD: AUTOMATION_SELECTOR_CATEGORY.FIELDS,
      ADD_COMMENT: AUTOMATION_SELECTOR_CATEGORY.COMMUNICATION,
      SEND_IN_APP_NOTIFICATION: AUTOMATION_SELECTOR_CATEGORY.COMMUNICATION,
      CREATE_SUBTASK: AUTOMATION_SELECTOR_CATEGORY.SUBTASKS,
    };

    return byAction[action] ?? AUTOMATION_SELECTOR_CATEGORY.WORK_ITEM;
  }

  /**
   * What a condition may be about, with the values it can be compared against.
   *
   * The `valueKind` is what makes the operator list type-aware — see
   * `OPERATORS_BY_VALUE_KIND`. Options are supplied for the fields whose values
   * are a fixed set, so the form offers this project's statuses rather than a
   * free text box that silently never matches.
   */
  private conditionFields(
    statuses: { id: string; name: string }[],
    priorities: { id: string; name: string }[],
    sections: { id: string; name: string }[],
    members: { user: { id: string; name: string } }[],
  ): ConditionFieldDefinition[] {
    return [
      /*
       * Definitions when the workspace has them, the legacy enum when it does
       * not.
       *
       * A workspace only grows status definitions once something creates them,
       * so a young project would otherwise offer a "Status is…" condition with
       * an empty list — a form that cannot be completed and a rule that can
       * never match. The enum is also what the runner compares against for any
       * task the definition backfill has not reached, so offering it is not a
       * consolation prize.
       */
      {
        field: 'status',
        label: 'Status',
        valueKind: ConditionValueKind.ENUM,
        options: statuses.length
          ? statuses.map((row) => ({ value: row.id, label: row.name }))
          : TASK_STATUSES.map((value) => ({ value, label: TASK_STATUS_DISPLAY[value].name })),
      },
      {
        field: 'priority',
        label: 'Priority',
        valueKind: ConditionValueKind.ENUM,
        options: priorities.length
          ? priorities.map((row) => ({ value: row.id, label: row.name }))
          : TASK_PRIORITIES.map((value) => ({
              value,
              label: TASK_PRIORITY_DISPLAY[value].name,
            })),
      },
      {
        field: 'sectionId',
        label: 'Section',
        valueKind: ConditionValueKind.REFERENCE,
        options: sections.map((row) => ({ value: row.id, label: row.name })),
      },
      {
        field: 'assigneeId',
        label: 'Assignee',
        valueKind: ConditionValueKind.REFERENCE,
        options: members.map((row) => ({ value: row.user.id, label: row.user.name })),
      },
      { field: 'title', label: 'Title', valueKind: ConditionValueKind.TEXT },
      { field: 'dueDate', label: 'Due date', valueKind: ConditionValueKind.DATE },
      { field: 'startDate', label: 'Start date', valueKind: ConditionValueKind.DATE },
    ];
  }
}

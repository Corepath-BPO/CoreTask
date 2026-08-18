import {
  TASK_PRIORITIES,
  TASK_PRIORITY_DISPLAY,
  TASK_STATUS_DISPLAY,
  TASK_STATUSES,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  AutomationCatalogEntry,
  AutomationMetadata,
  ConditionFieldDefinition,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../database/prisma.service';
import { ProjectsService } from '../../projects/projects.service';

import {
  CONDITION_FIELD_KINDS,
  actionCatalogue,
  capabilities,
  conditionCatalogue,
  permissionsFor,
  triggerCatalogue,
  type AutomationCapabilities,
  type AutomationConditionEntry,
  type AutomationPermissions,
  type AutomationTriggerEntry,
} from './automation-catalogue';

/**
 * The metadata response.
 *
 * Extends the shared shape rather than replacing it: `triggers` narrow to
 * entries carrying their configuration forms, and the three additions are the
 * parts a builder cannot work out for itself — what the catalogue offers, what
 * the engine can do, and what this caller may do with it.
 */
export interface AutomationMetadataResponse extends AutomationMetadata {
  triggers: AutomationTriggerEntry[];
  actions: AutomationCatalogEntry[];
  /** The condition catalogue, grouped and ordered. */
  conditions: AutomationConditionEntry[];
  customFields: { id: string; name: string; type: string; options: CustomFieldOption[] }[];
  capabilities: AutomationCapabilities;
  permissions: AutomationPermissions;
}

interface CustomFieldOption {
  id: string;
  label: string;
  colorToken: string;
}

/**
 * Everything the builder's forms need to offer real choices.
 *
 * Two jobs, and the split matters. The catalogue — which triggers, conditions
 * and actions exist and which of them run — is a fact about the engine and lives
 * in `automation-catalogue.ts`. This service answers the other half: what *this*
 * project holds. A form that offers a status the project does not define, or a
 * section belonging to somebody else's project, produces a rule that is accepted
 * and can never match, and one endpoint answering from the project is what stops
 * that happening.
 */
@Injectable()
export class AutomationMetadataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async forProject(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
  ): Promise<AutomationMetadataResponse> {
    await this.projects.requireProject(workspaceId, projectId);

    const [sections, statuses, priorities, members, customFields] = await Promise.all([
      /*
       * This project's own sections, in the order the board shows them.
       *
       * There is no archive flag on a section — deleting one is a delete — so
       * there is nothing to filter beyond the project. The scoping is the part
       * that matters: a section list leaking another project's rows would offer
       * a move across a tenant boundary, which the runner then refuses at
       * execution time as a rule that mysteriously never works.
       */
      this.prisma.section.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true },
      }),
      this.statusesFor(workspaceId, projectId),
      this.prisma.priorityDefinition.findMany({
        // Archived priorities were being offered alongside live ones, so a rule
        // could be built against a value nothing carries any more.
        where: { workspaceId, isArchived: false },
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
        select: {
          id: true,
          name: true,
          type: true,
          // The options come with the field because the generated condition and
          // action rows are useless without them: "Risk is…" needs the values
          // Risk can take, and a second round trip per field to fetch them
          // would be one request per row in the catalogue.
          options: {
            where: { isArchived: false },
            orderBy: { position: 'asc' },
            select: { id: true, label: true, colorToken: true },
          },
        },
      }),
    ]);

    return {
      triggers: triggerCatalogue(),
      actions: actionCatalogue(customFields),
      conditions: conditionCatalogue(customFields),
      conditionFields: this.conditionFields(statuses, priorities, sections, members),
      sections,
      statuses,
      priorities,
      members: members.map((row) => row.user),
      customFields,
      capabilities: capabilities(),
      permissions: permissionsFor(role, hasAtLeastRole(role, WorkspaceRole.MANAGER)),
    };
  }

  /**
   * The statuses this project actually uses.
   *
   * Its own set when it has one, the workspace default set when it does not —
   * the same resolution `DefinitionsService.statusesFor` performs, because a
   * project's status list has one right answer and two places computing it
   * differently is how a rule comes to name a status the board never shows.
   *
   * This used to be `OR: [{ projectId }, { projectId: null }]`, which merged the
   * two: a project that had renamed its statuses saw its own words *and* the
   * workspace's, duplicated, with no way to tell which of the two "In review"
   * rows the rule would compare against. Archived rows came through as well.
   */
  private async statusesFor(workspaceId: string, projectId: string) {
    const select = { id: true, name: true, colorToken: true } as const;

    const own = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, projectId, isArchived: false },
      orderBy: { position: 'asc' },
      select,
    });

    if (own.length > 0) return own;

    return this.prisma.statusDefinition.findMany({
      where: { workspaceId, projectId: null, isArchived: false },
      orderBy: { position: 'asc' },
      select,
    });
  }

  /**
   * What a condition may be about, with the values it can be compared against.
   *
   * The older, flatter view of the same question, kept because the graph
   * validator and the stored node configurations both speak it: a condition node
   * holds a `field` and a `FilterOperator`, and `valueKind` is what makes that
   * operator list type-aware. The new `conditions` catalogue is the picker; this
   * is what the picked row is configured with.
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
        valueKind: CONDITION_FIELD_KINDS.status,
        options: statuses.length
          ? statuses.map((row) => ({ value: row.id, label: row.name }))
          : TASK_STATUSES.map((value) => ({ value, label: TASK_STATUS_DISPLAY[value].name })),
      },
      {
        field: 'priority',
        label: 'Priority',
        valueKind: CONDITION_FIELD_KINDS.priority,
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
        valueKind: CONDITION_FIELD_KINDS.sectionId,
        options: sections.map((row) => ({ value: row.id, label: row.name })),
      },
      {
        field: 'assigneeId',
        label: 'Assignee',
        valueKind: CONDITION_FIELD_KINDS.assigneeId,
        options: members.map((row) => ({ value: row.user.id, label: row.user.name })),
      },
      {
        /*
         * Offered because the runner already reads it.
         *
         * `createdById` had a case in `readField` and no entry here, so the one
         * layer that decides what the builder may offer left out a comparison
         * the engine could have made all along — the mirror of offering one it
         * cannot, and just as invisible.
         */
        field: 'createdById',
        label: 'Task creator',
        valueKind: CONDITION_FIELD_KINDS.createdById,
        options: members.map((row) => ({ value: row.user.id, label: row.user.name })),
      },
      { field: 'title', label: 'Title', valueKind: CONDITION_FIELD_KINDS.title },
      { field: 'description', label: 'Description', valueKind: CONDITION_FIELD_KINDS.description },
      { field: 'dueDate', label: 'Due date', valueKind: CONDITION_FIELD_KINDS.dueDate },
      { field: 'startDate', label: 'Start date', valueKind: CONDITION_FIELD_KINDS.startDate },
    ];
  }
}

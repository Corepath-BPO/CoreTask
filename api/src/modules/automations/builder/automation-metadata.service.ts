import {
  ConditionValueKind,
  TASK_PRIORITIES,
  TASK_PRIORITY_DISPLAY,
  TASK_STATUS_DISPLAY,
  TASK_STATUSES,
  WorkspaceRole,
  hasAtLeastRole,
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABEL,
  TASK_KINDS,
  TASK_KIND_LABEL,
  TICKET_CONDITION_FIELD_LABEL,
  TICKET_CONDITION_VALUES,
  TicketConditionField,
} from '@coretask/contracts';
import type {
  AutomationCapabilities,
  AutomationCatalogEntry,
  AutomationMetadata,
  ConditionFieldDefinition,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../database/prisma.service';
import { assignableIds } from '../../project-access/assignable';
import { ProjectsService } from '../../projects/projects.service';

import {
  CONDITION_FIELD_KINDS,
  actionCatalogue,
  capabilities,
  conditionCatalogue,
  customFieldKey,
  kindForCustomFieldType,
  permissionsFor,
  triggerCatalogue,
  type AutomationConditionEntry,
  type AutomationPermissions,
  type AutomationTriggerEntry,
} from './automation-catalogue';
import { projectStatuses } from './project-statuses';

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
    private readonly config: AppConfigService,
  ) {}

  async forProject(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
  ): Promise<AutomationMetadataResponse> {
    await this.projects.requireProject(workspaceId, projectId);

    const [
      sections,
      projects,
      statuses,
      priorities,
      members,
      fieldLinks,
      webhookEndpoints,
      teams,
      assignable,
    ] = await Promise.all([
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
      /*
       * Where a task can be moved to: every other live project in the
       * workspace, each with its sections in board order. Scoped to the
       * workspace for the same reason the sections above are — a project
       * from another tenant offered here would be a move across a boundary
       * that the runner then refuses as a rule that never works.
       */
      this.prisma.project.findMany({
        where: { workspaceId, archivedAt: null, id: { not: projectId } },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          color: true,
          sections: { orderBy: { position: 'asc' }, select: { id: true, name: true } },
        },
      }),
      projectStatuses(this.prisma, workspaceId, projectId),
      this.prisma.priorityDefinition.findMany({
        // Archived priorities were being offered alongside live ones, so a rule
        // could be built against a value nothing carries any more.
        where: { workspaceId, isArchived: false },
        orderBy: { level: 'asc' },
        select: { id: true, name: true, colorToken: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId, user: { isServiceAccount: false } },
        select: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      }),
      /*
       * Through the project link, for its order.
       *
       * The fields used to be fetched directly and sorted by name, which put
       * the generated catalogue rows in alphabetical order — a different order
       * from the one the project's own list view shows the same fields in, and
       * from the one somebody arranged them into. The link row carries the
       * project's ordering, so the catalogue reads like the board does.
       */
      this.prisma.projectCustomField.findMany({
        where: { projectId, customField: { workspaceId, isArchived: false } },
        orderBy: { position: 'asc' },
        select: {
          customField: {
            select: {
              id: true,
              name: true,
              type: true,
              // The options come with the field because the generated condition
              // and action rows are useless without them: "Risk is…" needs the
              // values Risk can take, and a second round trip per field to
              // fetch them would be one request per row in the catalogue.
              options: {
                where: { isArchived: false },
                orderBy: { position: 'asc' },
                select: { id: true, label: true, colorToken: true },
              },
            },
          },
        },
      }),
      /*
       * Where a "Send a webhook" step can send. Every endpoint, disabled ones
       * included, so a rule already pointing at one can still show it; the
       * step greys it out. The host stands in for the URL — see the type.
       */
      this.prisma.webhookEndpoint.findMany({
        where: { workspaceId, apiKeyId: null, oauthGrantId: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, url: true, enabled: true },
      }),
      // The workspace's teams, for "Change team to…". Every member sees
      // every team — a team is not a permission boundary.
      this.prisma.team.findMany({
        where: { workspaceId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, color: true },
      }),
      // Who "Assign to" and a checklist may give work to: the runner holds
      // a rule to the same list.
      assignableIds(this.prisma, workspaceId, [projectId]),
    ]);

    const customFields = fieldLinks.map((link) => link.customField);
    // Whether the AI steps have a model behind them on this server.
    const ai = this.config.ai.enabled;

    return {
      triggers: triggerCatalogue(customFields),
      actions: actionCatalogue(customFields, ai),
      conditions: conditionCatalogue(customFields, ai),
      conditionFields: this.conditionFields(statuses, priorities, sections, members, customFields),
      sections,
      webhookEndpoints: webhookEndpoints.map((row) => ({
        id: row.id,
        name: row.name,
        host: hostOf(row.url),
        enabled: row.enabled,
      })),
      projects,
      statuses,
      priorities,
      members: members.map((row) => row.user),
      assignees: members.map((row) => row.user).filter((user) => assignable?.has(user.id) ?? true),
      teams,
      customFields,
      capabilities: capabilities(ai),
      permissions: permissionsFor(role, hasAtLeastRole(role, WorkspaceRole.MANAGER)),
    };
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
    statuses: { id: string; name: string; colorToken: string }[],
    priorities: { id: string; name: string; colorToken: string }[],
    sections: { id: string; name: string }[],
    members: { user: { id: string; name: string } }[],
    customFields: { id: string; name: string; type: string; options: CustomFieldOption[] }[],
  ): ConditionFieldDefinition[] {
    /*
     * The custom fields, under the same keys their conditions store.
     *
     * Without these the form for "[Field] is…" had no definition to resolve —
     * no label, no options — so the value control could not offer the field's
     * own choices and the card printed option ids at people.
     *
     * The colour comes with each option because the builder renders the value
     * as the tinted chip the board shows it as — a colourless "Renewed" beside
     * a green one elsewhere reads as a different value.
     */
    const generated: ConditionFieldDefinition[] = customFields.map((field) => ({
      field: customFieldKey(field.id),
      label: field.name,
      valueKind: kindForCustomFieldType(field.type) ?? ConditionValueKind.TEXT,
      /*
       * A people field's choices are the workspace's members — it defines no
       * options of its own, and without these the form fell back to a bare
       * text box asking somebody to type a user id.
       */
      ...(field.type === 'PEOPLE'
        ? { options: members.map((row) => ({ value: row.user.id, label: row.user.name })) }
        : field.options.length > 0
          ? {
              options: field.options.map((option) => ({
                value: option.id,
                label: option.label,
                colorToken: option.colorToken,
              })),
            }
          : {}),
    }));

    // A ticket rule's fields: fixed values, and the members for its assignee.
    const ticketChoices = (values: readonly string[]) =>
      values.map((value) => ({
        value,
        label: value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' '),
      }));
    const ticketFields: ConditionFieldDefinition[] = [
      ...(
        Object.entries(TICKET_CONDITION_VALUES) as [
          keyof typeof TICKET_CONDITION_VALUES,
          readonly string[],
        ][]
      ).map(([field, values]) => ({
        field,
        label: TICKET_CONDITION_FIELD_LABEL[field],
        valueKind: ConditionValueKind.ENUM,
        options: ticketChoices(values),
      })),
      {
        field: TicketConditionField.ASSIGNEE,
        label: TICKET_CONDITION_FIELD_LABEL[TicketConditionField.ASSIGNEE],
        valueKind: ConditionValueKind.REFERENCE,
        options: members.map((row) => ({ value: row.user.id, label: row.user.name })),
      },
    ];

    return [
      ...generated,
      ...ticketFields,
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
          ? statuses.map((row) => ({ value: row.id, label: row.name, colorToken: row.colorToken }))
          : TASK_STATUSES.map((value) => ({
              value,
              label: TASK_STATUS_DISPLAY[value].name,
              colorToken: TASK_STATUS_DISPLAY[value].colorToken,
            })),
      },
      {
        field: 'priority',
        label: 'Priority',
        valueKind: CONDITION_FIELD_KINDS.priority,
        options: priorities.length
          ? priorities.map((row) => ({
              value: row.id,
              label: row.name,
              colorToken: row.colorToken,
            }))
          : TASK_PRIORITIES.map((value) => ({
              value,
              label: TASK_PRIORITY_DISPLAY[value].name,
              colorToken: TASK_PRIORITY_DISPLAY[value].colorToken,
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
      {
        field: 'estimatedMinutes',
        label: 'Estimate',
        valueKind: CONDITION_FIELD_KINDS.estimatedMinutes,
      },
      { field: 'createdAt', label: 'Created', valueKind: CONDITION_FIELD_KINDS.createdAt },
      { field: 'completedAt', label: 'Completed on', valueKind: CONDITION_FIELD_KINDS.completedAt },
      /*
       * Offered by the catalogue and read by the runner, but missing here, so
       * the panel had no definition for either: its heading printed the key and
       * "Choose an option" stayed empty and disabled, on a rule that ran fine.
       */
      {
        field: 'completed',
        label: 'Task or all subtasks completion status',
        valueKind: CONDITION_FIELD_KINDS.completed,
      },
      {
        field: 'IS_SUBTASK',
        label: 'Task is a subtask',
        valueKind: CONDITION_FIELD_KINDS.IS_SUBTASK,
      },
      {
        field: 'TASK_TYPE',
        label: 'Task type',
        valueKind: CONDITION_FIELD_KINDS.TASK_TYPE,
        options: TASK_KINDS.map((value) => ({ value, label: TASK_KIND_LABEL[value] })),
      },
      {
        field: 'APPROVAL_STATUS',
        label: 'Approval status',
        valueKind: CONDITION_FIELD_KINDS.APPROVAL_STATUS,
        options: APPROVAL_STATUSES.map((value) => ({
          value,
          label: APPROVAL_STATUS_LABEL[value],
        })),
      },
      {
        field: 'HAS_ATTACHMENT',
        label: 'Has an attachment',
        valueKind: CONDITION_FIELD_KINDS.HAS_ATTACHMENT,
      },
      {
        field: 'HAS_COMMENT',
        label: 'Has a comment',
        valueKind: CONDITION_FIELD_KINDS.HAS_COMMENT,
      },
      {
        field: 'NO_LONGER_BLOCKED',
        label: 'No longer blocked',
        valueKind: CONDITION_FIELD_KINDS.NO_LONGER_BLOCKED,
      },
    ];
  }
}

/** The host of a URL, or the URL itself when it will not parse — never throws over display text. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

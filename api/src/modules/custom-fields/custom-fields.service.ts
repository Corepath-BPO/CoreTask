import {
  ActivityAction,
  ActivityEntity,
  AutomationTrigger,
  CustomFieldType,
  SELECT_FIELD_TYPES,
  ServerEvent,
  WorkspaceRole,
  hasAtLeastRole,
  isComputedFieldType,
  validateFormula,
  type CustomFieldStoryMetadata,
  type FormulaFieldRef,
} from '@coretask/contracts';
import type {
  CustomField,
  RemoveFieldMode,
  RemoveFieldResult,
  TaskCustomFieldValue,
} from '@coretask/types';
import { safeParseFieldSettings } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { FieldChangeNotifier } from '../../integrations/notifications/field-change.notifier';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { ProjectsService } from '../projects/projects.service';
import { taskInclude, toTaskDto } from '../tasks/task.mapper';

import { toValueDto } from './custom-field-value.mapper';
import type {
  CreateCustomFieldDto,
  CreateFieldOptionDto,
  SetCustomFieldValueDto,
  UpdateCustomFieldDto,
  UpdateFieldOptionDto,
  UpdateWorkspaceCustomFieldDto,
} from './dto/custom-field.dto';
import { labelValue } from './lib/value-labels';

/*
 * Every option, archived ones included. A cell still holding an archived
 * option renders its label from here; the pickers hide it; and a value naming
 * it is refused by `buildValue`, which checks against `liveOptions` only.
 */
const fieldInclude = {
  options: { orderBy: { position: 'asc' } },
} satisfies Prisma.CustomFieldInclude;

/*
 * A project's field is read through its association, never straight off the
 * definition. The definition says what the field *is*; the association says
 * where it sits in this project, whether it is required here, and whether a
 * change is worth telling collaborators about. Both halves are needed to
 * answer "what are this project's fields", and reading only the definition is
 * how a field ends up at position 0 on every project at once.
 */
const linkInclude = {
  customField: { include: fieldInclude },
} satisfies Prisma.ProjectCustomFieldInclude;

type FieldLink = Prisma.ProjectCustomFieldGetPayload<{ include: typeof linkInclude }>;

/**
 * A field as one project sees it: the definition, plus the facts that are only
 * true here.
 *
 * Value validation needs both halves at once — the type and options come from
 * the definition, but whether a blank is allowed is per-project — so they are
 * flattened rather than threaded through every rule as two arguments.
 */
export type ProjectField = FieldLink['customField'] & {
  isRequired: boolean;
  notifyOnChange: boolean;
};

function resolve(link: FieldLink): ProjectField {
  return {
    ...link.customField,
    isRequired: link.isRequired,
    notifyOnChange: link.notifyOnChange,
  };
}

function liveOptions(field: ProjectField): ProjectField['options'] {
  return field.options.filter((option) => !option.isArchived);
}

/** Where a value change came from; the story carries it. */
export type ValueSource = 'USER' | 'BULK' | 'AUTOMATION';

export interface SetValueOptions {
  source?: ValueSource;
  correlationId?: string | undefined;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityLogsService,
    private readonly realtime: RealtimeGateway,
    private readonly automation: AutomationEventPublisher,
    private readonly fieldChanges: FieldChangeNotifier,
  ) {}

  async list(workspaceId: string, projectId: string): Promise<CustomField[]> {
    await this.projects.requireProject(workspaceId, projectId);

    const links = await this.prisma.projectCustomField.findMany({
      where: { projectId, customField: { isArchived: false } },
      include: linkInclude,
      orderBy: { position: 'asc' },
    });

    return links.map(toFieldDto);
  }

  async get(workspaceId: string, projectId: string, fieldId: string): Promise<CustomField> {
    return toFieldDto(await this.requireField(workspaceId, projectId, fieldId));
  }

  async create(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    dto: CreateCustomFieldDto,
  ): Promise<CustomField> {
    await this.projects.requireProject(workspaceId, projectId);
    this.assertMayManage(role);

    const type = dto.type as CustomFieldType;
    const isSelect = SELECT_FIELD_TYPES.includes(type);

    /*
     * Parsed against the type before anything is written. Defaults are filled
     * in here rather than left absent, so a field always carries a complete
     * settings document and no reader has to know what a missing key meant.
     */
    const settings = this.parseSettings(type, dto.settings);

    // A select field with no options is a column nobody can fill in, and the
    // failure only shows up when someone tries to use it.
    if (isSelect && !dto.options?.length) {
      throw AppException.badRequest('BAD_REQUEST', 'A select field needs at least one option.');
    }

    if (!isSelect && dto.options?.length) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A ${type.toLowerCase()} field does not take options.`,
      );
    }

    if (type === CustomFieldType.FORMULA) {
      this.assertNotRequired(dto.isRequired);
      await this.assertFormulaReferences(projectId, null, settings);
    }

    const last = await this.prisma.projectCustomField.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    /*
     * One transaction, because a definition without an association is a field
     * nobody can see and nobody can delete: it belongs to the workspace but
     * appears on no project. Creating it and attaching it are one act.
     */
    const link = await this.prisma
      .$transaction(async (tx) => {
        const field = await tx.customField.create({
          data: {
            workspaceId,
            name: dto.name,
            description: dto.description ?? null,
            type,
            settings,
            createdById: userId,
            ...(dto.options?.length
              ? {
                  options: {
                    create: dto.options.map((option, index) => ({
                      label: option.label,
                      colorToken: option.colorToken ?? 'gray',
                      position: index,
                    })),
                  },
                }
              : {}),
          },
        });

        return tx.projectCustomField.create({
          data: {
            projectId,
            customFieldId: field.id,
            isRequired: dto.isRequired ?? false,
            notifyOnChange: dto.notifyOnChange ?? false,
            position: (last?.position ?? 0) + 1,
          },
          include: linkInclude,
        });
      })
      .catch(rethrowDuplicateName);

    const field = link.customField;

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      summary: `Added the field "${field.name}"`,
      metadata: { fieldId: field.id, type },
    });

    return toFieldDto(link);
  }

  async update(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    fieldId: string,
    dto: UpdateCustomFieldDto,
  ): Promise<CustomField> {
    const field = await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);
    const type = field.customField.type as CustomFieldType;

    /*
     * Split by what the change means. Renaming a field renames it everywhere it
     * is used, because it is one field; making it required, moving it, or
     * flagging it for notifications is true of this project only.
     */
    const definition: Prisma.CustomFieldUpdateInput = {};
    if (dto.settings !== undefined) {
      const settings = this.parseSettings(type, dto.settings);
      if (type === CustomFieldType.FORMULA) {
        await this.assertFormulaReferences(projectId, fieldId, settings);
      }
      definition.settings = settings;
    }
    if (dto.name !== undefined) definition.name = dto.name;
    if (dto.description !== undefined) definition.description = dto.description;
    if (dto.isArchived !== undefined) definition.isArchived = dto.isArchived;

    const association: Prisma.ProjectCustomFieldUpdateInput = {};
    if (dto.isRequired !== undefined) {
      if (type === CustomFieldType.FORMULA) this.assertNotRequired(dto.isRequired);
      association.isRequired = dto.isRequired;
    }
    if (dto.notifyOnChange !== undefined) association.notifyOnChange = dto.notifyOnChange;
    if (dto.position !== undefined) association.position = dto.position;

    if (Object.keys(definition).length === 0 && Object.keys(association).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    // `type` is deliberately absent: changing it would strand every value
    // already stored in the old type's column, and there is no honest
    // conversion from a date to a checkbox.
    await this.prisma
      .$transaction(async (tx) => {
        if (Object.keys(definition).length > 0) {
          await tx.customField.update({ where: { id: fieldId }, data: definition });
        }

        if (Object.keys(association).length > 0) {
          await tx.projectCustomField.update({
            where: { projectId_customFieldId: { projectId, customFieldId: fieldId } },
            data: association,
          });
        }
      })
      .catch(rethrowDuplicateName);

    return this.get(workspaceId, projectId, fieldId);
  }

  /**
   * The definition alone — rename, re-describe, archive or restore — with no
   * project in the URL.
   *
   * A field detached from its last project and archived is reachable no other
   * way: the project routes go through the association, and it has none. This
   * is how the library's "Restore" works. Settings are not accepted here,
   * because a formula's references can only be checked against a project.
   */
  async updateDefinition(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    fieldId: string,
    dto: UpdateWorkspaceCustomFieldDto,
  ): Promise<CustomField> {
    this.assertMayManage(role);

    const field = await this.prisma.customField.findFirst({
      where: { id: fieldId, workspaceId },
      select: { id: true, name: true, isArchived: true },
    });
    if (!field) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Field not found.');
    }

    const data: Prisma.CustomFieldUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;
    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    const updated = await this.prisma.customField.update({
      where: { id: fieldId },
      data,
      include: fieldInclude,
    });

    if (field.isArchived && dto.isArchived === false) {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.RESTORED,
        entity: ActivityEntity.WORKSPACE,
        entityId: workspaceId,
        summary: `Restored the field "${updated.name}" to the library`,
        metadata: { fieldId },
      });
    }

    return toLibraryFieldDto(updated);
  }

  /**
   * Removes a field from this project.
   *
   * `mode` says what the person meant. `'detach'` leaves the definition in the
   * library for the other projects that use it, or for later. `'delete'` takes
   * it out of every project — and still archives rather than deletes when
   * tasks hold values, because a field is easy to recreate and its data is
   * not. No `mode` keeps the older behaviour, chosen from state: detach while
   * another project uses it, archive when values exist, delete otherwise.
   *
   * A field a formula on this project reads cannot leave: the formula would
   * go blank without a word, which is worse than being told.
   */
  async remove(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    fieldId: string,
    mode?: RemoveFieldMode,
  ): Promise<RemoveFieldResult> {
    const field = await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);
    await this.assertNotReferencedByFormula(projectId, fieldId, field.customField.name);

    const name = field.customField.name;

    if (mode === 'delete') {
      const detached = await this.prisma.projectCustomField.deleteMany({
        where: { customFieldId: fieldId },
      });
      const valueCount = await this.prisma.taskCustomFieldValue.count({
        where: { customFieldId: fieldId },
      });

      if (valueCount > 0) {
        await this.prisma.customField.update({
          where: { id: fieldId },
          data: { isArchived: true },
        });
        await this.activity.record({
          workspaceId,
          actorId: userId,
          action: ActivityAction.ARCHIVED,
          entity: ActivityEntity.PROJECT,
          entityId: projectId,
          summary: `Archived the field "${name}"`,
          metadata: { fieldId, valueCount, mode, detachedProjects: detached.count },
        });
        return { deleted: false, archived: true, detachedProjects: detached.count };
      }

      await this.prisma.customField.delete({ where: { id: fieldId } });
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.DELETED,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        summary: `Deleted the field "${name}"`,
        metadata: { fieldId, mode, detachedProjects: detached.count },
      });
      return { deleted: true, archived: false, detachedProjects: detached.count };
    }

    await this.prisma.projectCustomField.delete({
      where: { projectId_customFieldId: { projectId, customFieldId: fieldId } },
    });

    const [remainingProjects, valueCount] = await Promise.all([
      this.prisma.projectCustomField.count({ where: { customFieldId: fieldId } }),
      this.prisma.taskCustomFieldValue.count({ where: { customFieldId: fieldId } }),
    ]);

    if (mode === 'detach' || remainingProjects > 0) {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        summary: `Removed the field "${name}" from this project`,
        metadata: { fieldId, remainingProjects, mode: mode ?? null },
      });

      return { deleted: false, archived: false, detachedProjects: 1 };
    }

    if (valueCount > 0) {
      await this.prisma.customField.update({
        where: { id: fieldId },
        data: { isArchived: true },
      });

      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.ARCHIVED,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        summary: `Archived the field "${name}"`,
        metadata: { fieldId, valueCount },
      });

      return { deleted: false, archived: true, detachedProjects: 1 };
    }

    await this.prisma.customField.delete({ where: { id: fieldId } });
    return { deleted: true, archived: false, detachedProjects: 1 };
  }

  /**
   * Puts an existing workspace field to work on this project.
   *
   * This is the whole point of the library: the same "Risk" field, with the
   * same options, reported on across every project that uses it. Attaching
   * creates an association, never a second definition, so two projects sharing
   * a field really are sharing it. A formula comes only where the fields it
   * reads already are.
   */
  async attach(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    fieldId: string,
  ): Promise<CustomField> {
    await this.projects.requireProject(workspaceId, projectId);
    this.assertMayManage(role);

    // Scoped to the workspace: a field id from another tenant must not become
    // attachable merely by being named in a URL this caller can reach.
    const field = await this.prisma.customField.findFirst({
      where: { id: fieldId, workspaceId },
      select: { id: true, name: true, type: true, settings: true, isArchived: true },
    });

    if (!field) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Field not found.');
    }

    if (field.isArchived) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `"${field.name}" is archived. Restore it before adding it to a project.`,
      );
    }

    const existing = await this.prisma.projectCustomField.findUnique({
      where: { projectId_customFieldId: { projectId, customFieldId: fieldId } },
    });

    if (existing) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This project already uses that field.');
    }

    if (field.type === CustomFieldType.FORMULA) {
      await this.assertFormulaReferences(projectId, fieldId, field.settings, field.name);
    }

    const last = await this.prisma.projectCustomField.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    await this.prisma.projectCustomField.create({
      data: { projectId, customFieldId: fieldId, position: (last?.position ?? 0) + 1 },
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      summary: `Added the existing field "${field.name}" to this project`,
      metadata: { fieldId },
    });

    return this.get(workspaceId, projectId, fieldId);
  }

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------

  async addOption(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    fieldId: string,
    dto: CreateFieldOptionDto,
  ): Promise<CustomField> {
    const field = await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);
    this.assertSelectField(resolve(field));

    const last = await this.prisma.customFieldOption.findFirst({
      where: { customFieldId: fieldId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    await this.prisma.customFieldOption.create({
      data: {
        customFieldId: fieldId,
        label: dto.label,
        colorToken: dto.colorToken ?? 'gray',
        position: (last?.position ?? 0) + 1,
      },
    });

    return this.get(workspaceId, projectId, fieldId);
  }

  /** Label, colour, order — and Asana's "hide option", which is `isArchived`. */
  async updateOption(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    fieldId: string,
    optionId: string,
    dto: UpdateFieldOptionDto,
  ): Promise<CustomField> {
    await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);
    await this.requireOption(fieldId, optionId);

    await this.prisma.customFieldOption.update({
      where: { id: optionId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.colorToken !== undefined ? { colorToken: dto.colorToken } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
    });

    return this.get(workspaceId, projectId, fieldId);
  }

  /**
   * Archives an option that is in use, deletes one that is not.
   *
   * A task holding a deleted option id would render a blank cell with no way to
   * find out what it used to say. Archiving keeps the label resolvable while
   * removing it from the picker.
   */
  async removeOption(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    fieldId: string,
    optionId: string,
  ): Promise<CustomField> {
    await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);
    await this.requireOption(fieldId, optionId);

    const inUse = await this.prisma.taskCustomFieldValue.count({
      where: { customFieldId: fieldId, optionIds: { has: optionId } },
    });

    if (inUse > 0) {
      await this.prisma.customFieldOption.update({
        where: { id: optionId },
        data: { isArchived: true },
      });
    } else {
      await this.prisma.customFieldOption.delete({ where: { id: optionId } });
    }

    return this.get(workspaceId, projectId, fieldId);
  }

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  /**
   * Writes one task's value for one field, after validating it against the
   * field's own definition.
   *
   * This is where "custom" stops meaning "unvalidated". Every type has a rule,
   * select values must name live options *of this field*, and people values
   * must be members of this workspace — otherwise a field becomes a way to
   * store arbitrary ids against a task.
   */
  async setValue(
    workspaceId: string,
    taskId: string,
    userId: string | null,
    fieldId: string,
    dto: SetCustomFieldValueDto,
    options: SetValueOptions = {},
  ): Promise<TaskCustomFieldValue> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: { id: true, projectId: true, title: true },
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    if (!task.projectId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Custom fields belong to a project, and this task is not in one.',
      );
    }

    const field = resolve(await this.requireField(workspaceId, task.projectId, fieldId));
    this.assertWritable(field);
    const data = await this.buildValue(workspaceId, field, dto);

    const previous = await this.prisma.taskCustomFieldValue.findUnique({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
    });

    const value = await this.prisma.taskCustomFieldValue.upsert({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
      create: { taskId, customFieldId: fieldId, updatedById: userId, ...data },
      update: { updatedById: userId, ...data },
    });

    await this.announce({
      workspaceId,
      projectId: task.projectId,
      taskId,
      taskTitle: task.title,
      actorId: userId,
      field,
      before: previous ? toValueDto(previous) : null,
      after: toValueDto(value),
      source: options.source ?? 'USER',
      correlationId: options.correlationId,
    });

    return toValueDto(value);
  }

  async clearValue(
    workspaceId: string,
    taskId: string,
    fieldId: string,
    userId?: string,
  ): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: { id: true, projectId: true, title: true },
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    const previous = await this.prisma.taskCustomFieldValue.findUnique({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
    });

    // Deleting rather than nulling every column: absent and empty mean the same
    // thing to a reader, and one representation is easier to reason about.
    await this.prisma.taskCustomFieldValue.deleteMany({
      where: { taskId, customFieldId: fieldId },
    });

    // Clearing a value is a change like any other. Skipped when there was
    // nothing there, so a repeated delete does not wake every rule again.
    if (previous && task.projectId) {
      const field = resolve(await this.requireField(workspaceId, task.projectId, fieldId));
      await this.announce({
        workspaceId,
        projectId: task.projectId,
        taskId,
        taskTitle: task.title,
        actorId: userId ?? null,
        field,
        before: toValueDto(previous),
        after: null,
        source: 'USER',
      });
    }
  }

  /** The fields a bulk edit names, all on this project, or a 404 before any write. */
  async requireProjectFields(
    workspaceId: string,
    projectId: string,
    fieldIds: readonly string[],
  ): Promise<Map<string, ProjectField>> {
    const links = await this.prisma.projectCustomField.findMany({
      where: { projectId, customFieldId: { in: [...fieldIds] }, customField: { workspaceId } },
      include: linkInclude,
    });
    const fields = new Map(links.map((link) => [link.customFieldId, resolve(link)]));

    for (const id of fieldIds) {
      if (!fields.has(id)) {
        throw AppException.notFound('RESOURCE_NOT_FOUND', 'Field not found.');
      }
    }

    return fields;
  }

  /** The rules `setValue` applies, without a task — so a bulk edit fails before its first row. */
  async validateValue(
    workspaceId: string,
    field: ProjectField,
    dto: SetCustomFieldValueDto,
  ): Promise<void> {
    this.assertWritable(field);
    await this.buildValue(workspaceId, field, dto);
  }

  /**
   * Tells the rest of the system that a task's field value changed.
   *
   * In order: the story the panel's feed reads, the collaborators' inbox line
   * when the project asked for one, the realtime push every open view
   * listens for, and the rule engine — after the write has landed, never
   * before, because a rule must react to what is true.
   */
  private async announce(change: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    taskTitle: string;
    actorId: string | null;
    field: ProjectField;
    before: TaskCustomFieldValue | null;
    after: TaskCustomFieldValue | null;
    source: ValueSource;
    correlationId?: string | undefined;
  }): Promise<void> {
    const { workspaceId, projectId, taskId, field } = change;

    const names = await this.peopleNames(field, change.before, change.after);
    const before = labelValue(field, change.before, names);
    const after = labelValue(field, change.after, names);

    const metadata: CustomFieldStoryMetadata = {
      fieldId: field.id,
      fieldName: field.name,
      type: field.type,
      before: before && before.label !== null ? before : null,
      after: after && after.label !== null ? after : null,
      source: change.source,
    };

    // A blank replaced by a blank (a cleared select set to nothing again) is
    // not a change anyone needs to read about.
    const changed = metadata.before !== null || metadata.after !== null;

    if (changed) {
      await this.activity.record({
        workspaceId,
        actorId: change.actorId,
        action: ActivityAction.FIELD_CHANGED,
        entity: ActivityEntity.TASK,
        entityId: taskId,
        summary:
          metadata.after === null
            ? `Cleared ${field.name}`
            : metadata.before === null
              ? `Set ${field.name} to ${metadata.after.label}`
              : `Changed ${field.name} from ${metadata.before.label} to ${metadata.after.label}`,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      });
    }

    if (changed && field.notifyOnChange) {
      await this.fieldChanges.notify({
        workspaceId,
        taskId,
        taskTitle: change.taskTitle,
        actorId: change.actorId,
        fieldName: field.name,
        before: metadata.before?.label ?? null,
        after: metadata.after?.label ?? null,
      });
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });

    if (task) {
      this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_UPDATED, toTaskDto(task));

      /*
       * The project room as well as the workspace one. The List and Board
       * subscribe to `work-item:*` on their project's room — a field edit that
       * only spoke `task:updated` to the workspace left every other viewer of
       * the same list showing the old chip until something else refetched.
       */
      this.realtime.emitToProject(projectId, ServerEvent.WORK_ITEM_UPDATED, {
        workspaceId,
        projectId,
        occurredAt: new Date().toISOString(),
        ...(change.correlationId ? { correlationId: change.correlationId } : {}),
      });
    }

    // Fire-and-forget, because a rule failing to enqueue must not fail the
    // edit that caused it.
    await this.automation.publish({
      workspaceId,
      projectId,
      trigger: AutomationTrigger.CUSTOM_FIELD_CHANGED,
      entityType: 'TASK',
      entityId: taskId,
      actorId: change.actorId,
      // The id as well as the name: a rule narrowed to one field matches on
      // the id, since the name is somebody's to rename at any time.
      before: { fieldId: field.id, fieldName: field.name, value: change.before },
      after: { fieldId: field.id, fieldName: field.name, value: change.after },
      ...(change.correlationId ? { correlationId: change.correlationId } : {}),
    });
  }

  /** The names a people value's story needs, in one query for both sides. */
  private async peopleNames(
    field: ProjectField,
    before: TaskCustomFieldValue | null,
    after: TaskCustomFieldValue | null,
  ): Promise<Map<string, string>> {
    if (field.type !== CustomFieldType.PEOPLE) return new Map();
    const ids = [...new Set([...(before?.userIds ?? []), ...(after?.userIds ?? [])])];
    if (ids.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async buildValue(
    workspaceId: string,
    field: ProjectField,
    dto: SetCustomFieldValueDto,
  ): Promise<Prisma.TaskCustomFieldValueUncheckedCreateInput extends never ? never : object> {
    const blank = {
      textValue: null,
      numberValue: null,
      dateValue: null,
      booleanValue: null,
      optionIds: [] as string[],
      userIds: [] as string[],
    };

    switch (field.type) {
      case CustomFieldType.TEXT:
        return { ...blank, textValue: requireString(field, dto.text) };

      case CustomFieldType.URL: {
        const url = requireString(field, dto.text);
        if (url !== null && !/^https?:\/\//i.test(url)) {
          throw AppException.badRequest('BAD_REQUEST', `"${field.name}" needs an http(s) URL.`);
        }
        return { ...blank, textValue: url };
      }

      case CustomFieldType.EMAIL: {
        const email = requireString(field, dto.text);
        if (email !== null && !EMAIL_PATTERN.test(email)) {
          throw AppException.badRequest(
            'BAD_REQUEST',
            `"${field.name}" needs a valid e-mail address.`,
          );
        }
        return { ...blank, textValue: email };
      }

      case CustomFieldType.NUMBER: {
        if (dto.number === undefined || dto.number === null) {
          this.assertOptional(field);
          return blank;
        }
        if (!Number.isFinite(dto.number)) {
          throw AppException.badRequest('BAD_REQUEST', `"${field.name}" needs a number.`);
        }
        return { ...blank, numberValue: dto.number };
      }

      // Stored like a number, so filters and sorts need no new case; the
      // bounds are the only thing a rating adds.
      case CustomFieldType.RATING: {
        if (dto.number === undefined || dto.number === null) {
          this.assertOptional(field);
          return blank;
        }
        const stars = maxRating(field);
        if (!Number.isInteger(dto.number) || dto.number < 1 || dto.number > stars) {
          throw AppException.badRequest(
            'BAD_REQUEST',
            `"${field.name}" takes a whole number of stars from 1 to ${stars}.`,
          );
        }
        return { ...blank, numberValue: dto.number };
      }

      case CustomFieldType.DATE: {
        if (!dto.date) {
          this.assertOptional(field);
          return blank;
        }
        const date = new Date(dto.date);
        if (Number.isNaN(date.getTime())) {
          throw AppException.badRequest('BAD_REQUEST', `"${field.name}" needs a valid date.`);
        }
        return { ...blank, dateValue: date };
      }

      case CustomFieldType.CHECKBOX:
        return { ...blank, booleanValue: dto.checkbox ?? false };

      case CustomFieldType.SINGLE_SELECT:
      case CustomFieldType.MULTI_SELECT: {
        const ids = dto.optionIds ?? [];

        if (ids.length === 0) {
          this.assertOptional(field);
          return blank;
        }

        if (field.type === CustomFieldType.SINGLE_SELECT && ids.length > 1) {
          throw AppException.badRequest('BAD_REQUEST', `"${field.name}" takes a single choice.`);
        }

        // Checked against this field's live options, not merely "is a uuid".
        // Without this a value could name an option from another field, or one
        // that was archived precisely to stop it being chosen.
        const valid = new Set(liveOptions(field).map((option) => option.id));
        const unknown = ids.filter((id) => !valid.has(id));

        if (unknown.length > 0) {
          throw AppException.badRequest(
            'BAD_REQUEST',
            `That is not an available choice for "${field.name}".`,
          );
        }

        return { ...blank, optionIds: ids };
      }

      case CustomFieldType.PEOPLE: {
        const ids = dto.userIds ?? [];

        if (ids.length === 0) {
          this.assertOptional(field);
          return blank;
        }

        const members = await this.prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { in: ids } },
          select: { userId: true },
        });

        if (members.length !== ids.length) {
          throw AppException.badRequest(
            'BAD_REQUEST',
            'Only members of this workspace can be named in a people field.',
          );
        }

        return { ...blank, userIds: ids };
      }

      default:
        throw AppException.badRequest('BAD_REQUEST', 'That field type cannot be set yet.');
    }
  }

  /**
   * Validates a settings document against the field type it belongs to.
   *
   * Reported as a 422 with the offending path rather than a bare 500: a client
   * sending `decimalPlaces: 9` deserves to be told which key was wrong.
   */
  private parseSettings(type: CustomFieldType, settings: unknown): Prisma.InputJsonValue {
    const result = safeParseFieldSettings(type, settings);

    if (!result.success) {
      const issue = result.error.issues[0];
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        `Invalid setting${issue?.path.length ? ` "${issue.path.join('.')}"` : ''}: ${issue?.message ?? 'not allowed for this field type.'}`,
      );
    }

    return result.data as Prisma.InputJsonValue;
  }

  /**
   * A formula may only read fields this project has, of a kind it can read,
   * and never itself or a loop of formulas. Checked here because only the
   * service holds the project; the Zod schema checks syntax alone.
   */
  private async assertFormulaReferences(
    projectId: string,
    selfId: string | null,
    settings: unknown,
    selfName?: string,
  ): Promise<void> {
    const expression = (settings as { expression?: unknown } | null)?.expression;
    if (typeof expression !== 'string') {
      throw AppException.unprocessable('VALIDATION_FAILED', 'A formula needs an expression.');
    }

    const links = await this.prisma.projectCustomField.findMany({
      where: { projectId },
      select: {
        customField: { select: { id: true, name: true, type: true, settings: true } },
      },
    });

    const fields = new Map<string, FormulaFieldRef>(
      links.map((link) => [
        link.customField.id,
        {
          id: link.customField.id,
          name: link.customField.name,
          type: link.customField.type,
          expression: (link.customField.settings as { expression?: unknown } | null)?.expression as
            string | undefined,
        },
      ]),
    );

    const result = validateFormula(expression, {
      fields,
      ...(selfId ? { selfId } : {}),
    });
    if (!result.ok) {
      const prefix = selfName ? `“${selfName}” cannot be added here: ` : '';
      throw AppException.unprocessable('VALIDATION_FAILED', `${prefix}${result.error.message}`);
    }
  }

  /** Refuses to remove a field while a formula on this project reads it. */
  private async assertNotReferencedByFormula(
    projectId: string,
    fieldId: string,
    fieldName: string,
  ): Promise<void> {
    const formulas = await this.prisma.projectCustomField.findMany({
      where: { projectId, customField: { type: CustomFieldType.FORMULA } },
      select: { customField: { select: { name: true, settings: true } } },
    });

    const token = `{field:${fieldId.toLowerCase()}}`;
    const dependants = formulas
      .filter((link) => {
        const expression = (link.customField.settings as { expression?: unknown } | null)
          ?.expression;
        return typeof expression === 'string' && expression.toLowerCase().includes(token);
      })
      .map((link) => link.customField.name);

    if (dependants.length > 0) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        `"${fieldName}" is used by the formula ${dependants.map((name) => `“${name}”`).join(', ')}. Change the formula first.`,
      );
    }
  }

  private assertNotRequired(isRequired: boolean | undefined): void {
    if (isRequired) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        'A formula is worked out, not filled in, so it cannot be required.',
      );
    }
  }

  /** A computed field is nobody's to set — not a cell, not a bulk edit, not a rule. */
  private assertWritable(field: ProjectField): void {
    if (isComputedFieldType(field.type)) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        `"${field.name}" is calculated and cannot be set.`,
      );
    }
  }

  private assertOptional(field: ProjectField): void {
    if (field.isRequired) {
      throw AppException.badRequest('BAD_REQUEST', `"${field.name}" is required.`);
    }
  }

  private assertSelectField(field: ProjectField): void {
    if (!SELECT_FIELD_TYPES.includes(field.type)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `"${field.name}" is not a select field, so it has no options.`,
      );
    }
  }

  /** Managing the shape of a project's data is a MANAGER decision. */
  private assertMayManage(role: WorkspaceRole): void {
    if (!hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only a workspace manager can change a project’s fields.',
      );
    }
  }

  private async requireField(
    workspaceId: string,
    projectId: string,
    fieldId: string,
  ): Promise<FieldLink> {
    /*
     * Scoped by association *and* by the definition's workspace. The
     * association alone would let a caller reach a field through a project they
     * can see; the workspace check is what ties the definition to the tenant in
     * the URL.
     */
    const link = await this.prisma.projectCustomField.findFirst({
      where: { projectId, customFieldId: fieldId, customField: { workspaceId } },
      include: linkInclude,
    });

    if (!link) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Field not found.');
    }

    return link;
  }

  private async requireOption(fieldId: string, optionId: string): Promise<void> {
    const option = await this.prisma.customFieldOption.findFirst({
      where: { id: optionId, customFieldId: fieldId },
      select: { id: true },
    });

    if (!option) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Option not found.');
    }
  }
}

function maxRating(field: ProjectField): number {
  const stars = (field.settings as { maxRating?: unknown } | null)?.maxRating;
  return typeof stars === 'number' && stars >= 1 ? stars : 5;
}

function requireString(field: ProjectField, value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';

  if (text === '') {
    if (field.isRequired) {
      throw AppException.badRequest('BAD_REQUEST', `"${field.name}" is required.`);
    }
    return null;
  }

  return text;
}

/*
 * Only the association is unique now, not the name. Two projects may each have
 * a "Status" field with different options, so a name collision is a warning the
 * picker shows, never a rejection here.
 */
function rethrowDuplicateName(error: unknown): never {
  if ((error as { code?: string }).code === 'P2002') {
    throw AppException.conflict('RESOURCE_CONFLICT', 'This project already uses that field.');
  }
  throw error;
}

type FieldRow = Prisma.CustomFieldGetPayload<{ include: typeof fieldInclude }>;

function optionsDto(field: FieldRow) {
  return field.options.map((option) => ({
    id: option.id,
    label: option.label,
    colorToken: option.colorToken,
    customColor: option.customColor,
    position: option.position,
    isArchived: option.isArchived,
  }));
}

/**
 * The wire shape is unchanged by the move to a library.
 *
 * `projectId`, `isRequired`, `notifyOnChange` and `position` come from the
 * association rather than the definition, so every existing client keeps
 * working while the model underneath is a workspace field used by N projects.
 */
function toFieldDto(link: FieldLink): CustomField {
  const field = link.customField;

  return {
    id: field.id,
    projectId: link.projectId,
    name: field.name,
    description: field.description,
    type: field.type,
    isRequired: link.isRequired,
    notifyOnChange: link.notifyOnChange,
    isArchived: field.isArchived,
    position: link.position,
    settings: (field.settings ?? {}) as Record<string, unknown>,
    options: optionsDto(field),
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  };
}

/** A definition with no project in hand: the per-project facts read as their defaults. */
function toLibraryFieldDto(field: FieldRow): CustomField {
  return {
    id: field.id,
    projectId: '',
    name: field.name,
    description: field.description,
    type: field.type,
    isRequired: false,
    notifyOnChange: false,
    isArchived: field.isArchived,
    position: 0,
    settings: (field.settings ?? {}) as Record<string, unknown>,
    options: optionsDto(field),
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  };
}

import {
  ActivityAction,
  ActivityEntity,
  AutomationTrigger,
  CustomFieldType,
  SELECT_FIELD_TYPES,
  ServerEvent,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { CustomField, TaskCustomFieldValue } from '@coretask/types';
import { safeParseFieldSettings } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { ProjectsService } from '../projects/projects.service';
import { taskInclude, toTaskDto } from '../tasks/task.mapper';

import type {
  CreateCustomFieldDto,
  CreateFieldOptionDto,
  SetCustomFieldValueDto,
  UpdateCustomFieldDto,
  UpdateFieldOptionDto,
} from './dto/custom-field.dto';

const fieldInclude = {
  options: { where: { isArchived: false }, orderBy: { position: 'asc' } },
} satisfies Prisma.CustomFieldInclude;

/*
 * A project's field is read through its association, never straight off the
 * definition. The definition says what the field *is*; the association says
 * where it sits in this project and whether it is required here. Both halves
 * are needed to answer "what are this project's fields", and reading only the
 * definition is how a field ends up at position 0 on every project at once.
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
type ProjectField = FieldLink['customField'] & { isRequired: boolean };

function resolve(link: FieldLink): ProjectField {
  return { ...link.customField, isRequired: link.isRequired };
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

    /*
     * Split by what the change means. Renaming a field renames it everywhere it
     * is used, because it is one field; making it required, or moving it, is
     * true of this project only.
     */
    const definition: Prisma.CustomFieldUpdateInput = {};
    if (dto.settings !== undefined) {
      definition.settings = this.parseSettings(
        field.customField.type as CustomFieldType,
        dto.settings,
      );
    }
    if (dto.name !== undefined) definition.name = dto.name;
    if (dto.description !== undefined) definition.description = dto.description;
    if (dto.isArchived !== undefined) definition.isArchived = dto.isArchived;

    const association: Prisma.ProjectCustomFieldUpdateInput = {};
    if (dto.isRequired !== undefined) association.isRequired = dto.isRequired;
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
   * Detaches a field from this project, and disposes of the definition only if
   * nothing else is using it.
   *
   * Three outcomes, in increasing order of finality:
   *
   *   * another project still uses the field — detach here, leave it alone;
   *   * this was the last project but tasks hold values — archive it, because
   *     a field is easy to add back and its data is not;
   *   * last project and no values — delete it, there is nothing to lose.
   *
   * The first case is what the library makes possible and what makes deleting
   * outright wrong: removing a column from one project must never take another
   * project's data with it.
   */
  async remove(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    fieldId: string,
  ): Promise<{ deleted: boolean; archived: boolean }> {
    const field = await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);

    await this.prisma.projectCustomField.delete({
      where: { projectId_customFieldId: { projectId, customFieldId: fieldId } },
    });

    const [remainingProjects, valueCount] = await Promise.all([
      this.prisma.projectCustomField.count({ where: { customFieldId: fieldId } }),
      this.prisma.taskCustomFieldValue.count({ where: { customFieldId: fieldId } }),
    ]);

    if (remainingProjects > 0) {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        summary: `Removed the field "${field.customField.name}" from this project`,
        metadata: { fieldId, remainingProjects },
      });

      return { deleted: false, archived: false };
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
        summary: `Archived the field "${field.customField.name}"`,
        metadata: { fieldId, valueCount },
      });

      return { deleted: false, archived: true };
    }

    await this.prisma.customField.delete({ where: { id: fieldId } });
    return { deleted: true, archived: false };
  }

  /**
   * Puts an existing workspace field to work on this project.
   *
   * This is the whole point of the library: the same "Risk" field, with the
   * same options, reported on across every project that uses it. Attaching
   * creates an association, never a second definition, so two projects sharing
   * a field really are sharing it.
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
      select: { id: true, name: true, isArchived: true },
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
    userId: string,
    fieldId: string,
    dto: SetCustomFieldValueDto,
  ): Promise<TaskCustomFieldValue> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: { id: true, projectId: true },
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

    const field = await this.requireField(workspaceId, task.projectId, fieldId);
    const data = await this.buildValue(workspaceId, resolve(field), dto);

    const previous = await this.prisma.taskCustomFieldValue.findUnique({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
    });

    const value = await this.prisma.taskCustomFieldValue.upsert({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
      create: { taskId, customFieldId: fieldId, updatedById: userId, ...data },
      update: { updatedById: userId, ...data },
    });

    await this.announce(
      workspaceId,
      task.projectId,
      taskId,
      userId,
      field.customField.name,
      previous ? toValueDto(previous) : null,
      toValueDto(value),
    );

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
      select: { id: true, projectId: true },
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    const previous = await this.prisma.taskCustomFieldValue.findUnique({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
      include: { customField: { select: { name: true } } },
    });

    // Deleting rather than nulling every column: absent and empty mean the same
    // thing to a reader, and one representation is easier to reason about.
    await this.prisma.taskCustomFieldValue.deleteMany({
      where: { taskId, customFieldId: fieldId },
    });

    // Clearing a value is a change like any other. Skipped when there was
    // nothing there, so a repeated delete does not wake every rule again.
    if (previous && task.projectId) {
      await this.announce(
        workspaceId,
        task.projectId,
        taskId,
        userId ?? null,
        previous.customField.name,
        toValueDto(previous),
        null,
      );
    }
  }

  /**
   * Tells the rest of the system that a task's field value changed.
   *
   * Neither of these existed before: a custom-field edit updated the database
   * and nothing else. The board and any other open view kept showing the old
   * value until something unrelated refetched, and `CUSTOM_FIELD_CHANGED` was a
   * trigger you could build a rule on that could never once fire.
   *
   * `TASK_UPDATED` rather than a bespoke event, because every view already
   * listens for it — a new event would need every listener taught about it.
   */
  private async announce(
    workspaceId: string,
    projectId: string,
    taskId: string,
    actorId: string | null,
    fieldName: string,
    before: TaskCustomFieldValue | null,
    after: TaskCustomFieldValue | null,
  ): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });

    if (task) {
      this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_UPDATED, toTaskDto(task));
    }

    // After the write has landed, never before: a rule must react to what is
    // true. Fire-and-forget, because a rule failing to enqueue must not fail
    // the edit that caused it.
    await this.automation.publish({
      workspaceId,
      projectId,
      trigger: AutomationTrigger.CUSTOM_FIELD_CHANGED,
      entityType: 'TASK',
      entityId: taskId,
      actorId,
      before: { fieldName, value: before },
      after: { fieldName, value: after },
    });
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
        const valid = new Set(field.options.map((option) => option.id));
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

/**
 * The wire shape is unchanged by the move to a library.
 *
 * `projectId`, `isRequired` and `position` now come from the association rather
 * than the definition, so every existing client keeps working while the model
 * underneath is a workspace field used by N projects.
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
    isArchived: field.isArchived,
    position: link.position,
    settings: (field.settings ?? {}) as Record<string, unknown>,
    options: field.options.map((option) => ({
      id: option.id,
      label: option.label,
      colorToken: option.colorToken,
      customColor: option.customColor,
      position: option.position,
      isArchived: option.isArchived,
    })),
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  };
}

function toValueDto(value: {
  customFieldId: string;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
  booleanValue: boolean | null;
  optionIds: string[];
  userIds: string[];
}): TaskCustomFieldValue {
  return {
    customFieldId: value.customFieldId,
    text: value.textValue,
    // Decimal keeps precision in PostgreSQL but JSON has no such type, so it
    // crosses the wire as a number — the range is far inside what is safe.
    number: value.numberValue === null ? null : Number(value.numberValue),
    date: value.dateValue?.toISOString() ?? null,
    checkbox: value.booleanValue,
    optionIds: value.optionIds,
    userIds: value.userIds,
  };
}

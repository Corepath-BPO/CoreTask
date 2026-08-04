import {
  ActivityAction,
  ActivityEntity,
  CustomFieldType,
  SELECT_FIELD_TYPES,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { CustomField, TaskCustomFieldValue } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { CustomField as PrismaCustomField, Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectsService } from '../projects/projects.service';

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

type FieldWithOptions = Prisma.CustomFieldGetPayload<{ include: typeof fieldInclude }>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityLogsService,
  ) {}

  async list(workspaceId: string, projectId: string): Promise<CustomField[]> {
    await this.projects.requireProject(workspaceId, projectId);

    const fields = await this.prisma.customField.findMany({
      where: { projectId, isArchived: false },
      include: fieldInclude,
      orderBy: { position: 'asc' },
    });

    return fields.map(toFieldDto);
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

    const last = await this.prisma.customField.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const field = await this.prisma.customField
      .create({
        data: {
          workspaceId,
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          type,
          isRequired: dto.isRequired ?? false,
          position: (last?.position ?? 0) + 1,
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
        include: fieldInclude,
      })
      .catch(rethrowDuplicateName);

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      summary: `Added the field "${field.name}"`,
      metadata: { fieldId: field.id, type },
    });

    return toFieldDto(field);
  }

  async update(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    fieldId: string,
    dto: UpdateCustomFieldDto,
  ): Promise<CustomField> {
    await this.requireField(workspaceId, projectId, fieldId);
    this.assertMayManage(role);

    const data: Prisma.CustomFieldUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isRequired !== undefined) data.isRequired = dto.isRequired;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;
    if (dto.position !== undefined) data.position = dto.position;

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    // `type` is deliberately absent: changing it would strand every value
    // already stored in the old type's column, and there is no honest
    // conversion from a date to a checkbox.
    const updated = await this.prisma.customField
      .update({ where: { id: fieldId }, data, include: fieldInclude })
      .catch(rethrowDuplicateName);

    return toFieldDto(updated);
  }

  /**
   * Archives a field rather than deleting it once it holds values.
   *
   * Deleting would take every task's value with it through the cascade, and a
   * field is easy to add back but its data is not. An unused field is deleted
   * outright, because there is nothing to lose.
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
        summary: `Archived the field "${field.name}"`,
        metadata: { fieldId, valueCount },
      });

      return { deleted: false, archived: true };
    }

    await this.prisma.customField.delete({ where: { id: fieldId } });
    return { deleted: true, archived: false };
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
    this.assertSelectField(field);

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
    const data = await this.buildValue(workspaceId, field, dto);

    const value = await this.prisma.taskCustomFieldValue.upsert({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
      create: { taskId, customFieldId: fieldId, updatedById: userId, ...data },
      update: { updatedById: userId, ...data },
    });

    return toValueDto(value);
  }

  async clearValue(workspaceId: string, taskId: string, fieldId: string): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: { id: true },
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    // Deleting rather than nulling every column: absent and empty mean the same
    // thing to a reader, and one representation is easier to reason about.
    await this.prisma.taskCustomFieldValue.deleteMany({
      where: { taskId, customFieldId: fieldId },
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async buildValue(
    workspaceId: string,
    field: FieldWithOptions,
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

  private assertOptional(field: PrismaCustomField): void {
    if (field.isRequired) {
      throw AppException.badRequest('BAD_REQUEST', `"${field.name}" is required.`);
    }
  }

  private assertSelectField(field: PrismaCustomField): void {
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
  ): Promise<FieldWithOptions> {
    const field = await this.prisma.customField.findFirst({
      where: { id: fieldId, projectId, workspaceId },
      include: fieldInclude,
    });

    if (!field) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Field not found.');
    }

    return field;
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

function requireString(field: PrismaCustomField, value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';

  if (text === '') {
    if (field.isRequired) {
      throw AppException.badRequest('BAD_REQUEST', `"${field.name}" is required.`);
    }
    return null;
  }

  return text;
}

function rethrowDuplicateName(error: unknown): never {
  if ((error as { code?: string }).code === 'P2002') {
    throw AppException.conflict('RESOURCE_CONFLICT', 'This project already has a field by that name.');
  }
  throw error;
}

function toFieldDto(field: FieldWithOptions): CustomField {
  return {
    id: field.id,
    projectId: field.projectId,
    name: field.name,
    description: field.description,
    type: field.type,
    isRequired: field.isRequired,
    isArchived: field.isArchived,
    position: field.position,
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

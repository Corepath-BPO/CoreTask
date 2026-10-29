import type { ColorToken } from '@coretask/contracts';
import type { CustomFieldType } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DefinitionsService } from '../definitions/definitions.service';

import type { CustomFieldMap } from './lib/query-compiler';

/**
 * One request for everything the Fields menu and filter builder need.
 *
 * Opening a menu should not be five round trips, and the four sets are always
 * wanted together — a filter row needs the field list *and* the values that
 * field can take.
 */
@Injectable()
export class FieldMetadataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fields: CustomFieldsService,
    private readonly definitions: DefinitionsService,
  ) {}

  async forProject(workspaceId: string, projectId: string): Promise<ProjectFieldMetadata> {
    const [customFields, statuses, priorities, sections, members, tags, assignable] =
      await Promise.all([
        this.fields.list(workspaceId, projectId),
        this.definitions.listStatuses(workspaceId, projectId),
        this.definitions.listPriorities(workspaceId),
        this.prisma.section.findMany({
          where: { projectId },
          orderBy: { position: 'asc' },
          select: { id: true, name: true },
        }),
        this.prisma.workspaceMember.findMany({
          where: { workspaceId, user: { isServiceAccount: false } },
          select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy: { user: { name: 'asc' } },
        }),
        this.prisma.tag.findMany({
          where: { workspaceId },
          orderBy: { nameKey: 'asc' },
          select: { id: true, name: true, color: true },
        }),
        this.assignableIds(workspaceId, projectId),
      ]);

    return {
      customFields,
      statuses: statuses.map((status) => ({
        id: status.id,
        name: status.name,
        category: status.category,
        colorToken: status.colorToken,
      })),
      priorities: priorities.map((priority) => ({
        id: priority.id,
        name: priority.name,
        level: priority.level,
        colorToken: priority.colorToken,
      })),
      sections,
      members: members.map((member) => member.user),
      assignees: members.map((member) => member.user).filter((user) => assignable.has(user.id)),
      tags: tags.map((tag) => ({ ...tag, color: tag.color as ColorToken })),
    };
  }

  /**
   * Who may be given a task in this project: its members, as Asana offers a
   * project's members, and the workspace's owner — whoever set the workspace
   * up is assignable everywhere, member or not.
   */
  private async assignableIds(workspaceId: string, projectId: string): Promise<Set<string>> {
    const [projectMembers, owners] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId, role: WorkspaceRole.OWNER },
        select: { userId: true },
      }),
    ]);
    return new Set([...projectMembers, ...owners].map((row) => row.userId));
  }

  /**
   * The project's fields keyed by id, for the query compiler.
   *
   * Only id and type: the compiler decides which column to read and which
   * operators apply, and never needs a label. Archived fields are included
   * deliberately — a saved view may still filter by one, and dropping it would
   * silently widen the result rather than report the problem.
   */
  async customFieldMap(workspaceId: string, projectId: string): Promise<CustomFieldMap> {
    const fields = await this.prisma.customField.findMany({
      where: { workspaceId, projects: { some: { projectId } } },
      select: { id: true, type: true },
    });

    return new Map(
      fields.map((field) => [field.id, { id: field.id, type: field.type as CustomFieldType }]),
    );
  }
}

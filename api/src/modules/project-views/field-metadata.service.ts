import type { CustomFieldType } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { Injectable } from '@nestjs/common';

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
    const [customFields, statuses, priorities, sections, members] = await Promise.all([
      this.fields.list(workspaceId, projectId),
      this.definitions.listStatuses(workspaceId, projectId),
      this.definitions.listPriorities(workspaceId),
      this.prisma.section.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        orderBy: { user: { name: 'asc' } },
      }),
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
    };
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

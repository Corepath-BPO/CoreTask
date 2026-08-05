import { CustomFieldType } from '@coretask/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

import {
  FIELD_TYPE_CATALOG,
  SYSTEM_FIELD_CATALOG,
  type FieldTypeDefinition,
  type SystemFieldDefinition,
} from './lib/system-field-catalog';

/** A custom field the picker can offer, with where it already stands. */
export interface CatalogField {
  id: string;
  name: string;
  description: string | null;
  type: CustomFieldType;
  optionPreview: { id: string; label: string; colorToken: string }[];
  /** How many projects in this workspace use it. */
  usageCount: number;
  /** Whether this project already uses it. */
  isInProject: boolean;
  isArchived: boolean;
}

export interface FieldCatalog {
  fieldTypes: FieldTypeDefinition[];
  systemFields: (SystemFieldDefinition & { isInView: boolean })[];
  projectFields: CatalogField[];
  libraryFields: CatalogField[];
}

export interface FieldCatalogQuery {
  search?: string;
  /** Field references already visible in the view being edited. */
  visible?: string[];
  includeLibrary?: boolean;
  includeArchived?: boolean;
}

/**
 * Everything the add-field picker needs, in one request.
 *
 * Four sources answer one question — "what can I put in this column?" — and
 * asking for them separately means four round trips and four chances for the
 * lists to disagree about what is already visible. Searching them together is
 * also the only way "date" can return the Date *type*, the Due date *field* and
 * a custom field called Delivery date in one ranked list.
 */
@Injectable()
export class FieldCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async build(
    workspaceId: string,
    projectId: string,
    query: FieldCatalogQuery = {},
  ): Promise<FieldCatalog> {
    await this.projects.requireProject(workspaceId, projectId);

    const term = query.search?.trim().toLowerCase() ?? '';
    const visible = new Set(query.visible ?? []);

    /*
     * Matched at word starts, not anywhere in the string.
     *
     * A plain `includes` looked reasonable until "date" returned the URL and
     * Email types, because both descriptions say "validate". Searching for a
     * field type by name should not surface two unrelated ones on a substring
     * nobody typed.
     */
    const matches = (...text: (string | null | undefined)[]) =>
      !term ||
      text.some((value) =>
        (value ?? '')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .some((word) => word.startsWith(term)),
      );

    /*
     * Every custom field in the workspace, with the project links that decide
     * which group it belongs to. One query rather than one for the project and
     * another for the library: the difference between them is a property of the
     * rows, not of the question.
     */
    const fields = await this.prisma.customField.findMany({
      where: {
        workspaceId,
        ...(query.includeArchived ? {} : { isArchived: false }),
      },
      include: {
        options: {
          where: { isArchived: false },
          orderBy: { position: 'asc' },
          take: 4,
          select: { id: true, label: true, colorToken: true },
        },
        projects: { select: { projectId: true } },
      },
      orderBy: { name: 'asc' },
    });

    const catalogFields = fields.map((field): CatalogField => {
      const projectIds = new Set(field.projects.map((link) => link.projectId));

      return {
        id: field.id,
        name: field.name,
        description: field.description,
        type: field.type as CustomFieldType,
        optionPreview: field.options,
        usageCount: projectIds.size,
        isInProject: projectIds.has(projectId),
        isArchived: field.isArchived,
      };
    });

    const matchesField = (field: CatalogField) =>
      matches(field.name, field.description, field.type.replace(/_/g, ' '));

    return {
      fieldTypes: FIELD_TYPE_CATALOG.filter((type) =>
        matches(type.label, type.description, type.type.replace(/_/g, ' ')),
      ),

      // `isInView` rather than filtering them out: a field already in the view
      // is shown ticked and disabled, because silently omitting it reads as the
      // search having failed to find it.
      systemFields: SYSTEM_FIELD_CATALOG.filter((field) =>
        matches(field.label, field.description),
      ).map((field) => ({ ...field, isInView: visible.has(field.key) })),

      projectFields: catalogFields
        .filter((field) => field.isInProject && matchesField(field))
        // Already a column here is still worth showing, ticked — see above.
        .filter((field) => !visible.has(`custom:${field.id}`)),

      libraryFields: query.includeLibrary === false
        ? []
        : catalogFields.filter((field) => !field.isInProject && matchesField(field)),
    };
  }
}

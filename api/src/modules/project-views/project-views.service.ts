import {
  ProjectViewScope,
  ProjectViewType,
  SystemField,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { ProjectView, ViewSettings } from '@coretask/types';
import { viewSettingsSchema } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, ProjectView as PrismaProjectView } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

import type { CreateProjectViewDto, UpdateProjectViewDto } from './dto/project-view.dto';

/** Columns a new List view starts with. */
const DEFAULT_LIST_COLUMNS = [
  SystemField.TITLE,
  SystemField.ASSIGNEE,
  SystemField.PRIORITY,
  SystemField.STATUS,
  SystemField.DUE_DATE,
];

@Injectable()
export class ProjectViewsService {
  private readonly logger = new Logger(ProjectViewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Every view the caller may see, with the project's defaults created if they
   * do not exist yet.
   *
   * Created lazily rather than in a migration: projects existed before views
   * did, new ones are created constantly, and a lazy create means both paths
   * converge without a backfill that could run twice.
   */
  async list(workspaceId: string, projectId: string, userId: string): Promise<ProjectView[]> {
    await this.projects.requireProject(workspaceId, projectId);
    await this.ensureDefaults(workspaceId, projectId);

    const views = await this.prisma.projectView.findMany({
      where: {
        projectId,
        // A personal view belongs to one person. Shared views are visible to
        // every member; someone else's personal view is not visible at all.
        OR: [{ scope: ProjectViewScope.PROJECT }, { ownerUserId: userId }],
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return views.map(toViewDto);
  }

  async get(
    workspaceId: string,
    projectId: string,
    userId: string,
    viewId: string,
  ): Promise<ProjectView> {
    return toViewDto(await this.requireView(workspaceId, projectId, userId, viewId));
  }

  async create(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    dto: CreateProjectViewDto,
  ): Promise<ProjectView> {
    await this.projects.requireProject(workspaceId, projectId);

    const scope = (dto.scope ?? ProjectViewScope.PROJECT) as ProjectViewScope;
    this.assertMayWriteScope(scope, role);

    const last = await this.prisma.projectView.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const view = await this.prisma.projectView.create({
      data: {
        workspaceId,
        projectId,
        name: dto.name,
        type: dto.type as ProjectViewType,
        scope,
        // Only personal views carry an owner; a shared view belongs to nobody
        // in particular, which is what stops it disappearing with its author.
        ownerUserId: scope === ProjectViewScope.PERSONAL ? userId : null,
        position: (last?.position ?? 0) + 1,
        settings: parseSettings(dto.settings, dto.type as ProjectViewType),
        createdById: userId,
      },
    });

    this.logger.log({ projectId, viewId: view.id, type: view.type }, 'Project view created');

    return toViewDto(view);
  }

  async update(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    viewId: string,
    dto: UpdateProjectViewDto,
  ): Promise<ProjectView> {
    const view = await this.requireView(workspaceId, projectId, userId, viewId);
    this.assertMayEdit(view, userId, role);

    const data: Prisma.ProjectViewUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isFavorite !== undefined) data.isFavorite = dto.isFavorite;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.settings !== undefined) {
      // Re-validated in full rather than merged blindly: a partial write of a
      // JSON column is how a settings document ends up in a shape nothing can
      // read.
      data.settings = parseSettings(dto.settings, view.type);
    }

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    const updated = await this.prisma.projectView.update({ where: { id: viewId }, data });
    return toViewDto(updated);
  }

  async duplicate(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    viewId: string,
  ): Promise<ProjectView> {
    const view = await this.requireView(workspaceId, projectId, userId, viewId);

    // A copy is a new view the caller owns, never a second default — two
    // defaults is a state with no correct answer.
    const scope = view.scope;
    this.assertMayWriteScope(scope, role);

    const created = await this.prisma.projectView.create({
      data: {
        workspaceId,
        projectId,
        name: `${view.name} copy`,
        type: view.type,
        scope,
        ownerUserId: scope === ProjectViewScope.PERSONAL ? userId : null,
        isDefault: false,
        position: view.position + 0.5,
        settings: view.settings as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    return toViewDto(created);
  }

  /**
   * Makes one view the project's default for its type.
   *
   * Scoped to the type: a project has a default List *and* a default Board, and
   * clearing across types would leave whichever the user did not touch with no
   * default at all.
   */
  async setDefault(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    viewId: string,
  ): Promise<ProjectView> {
    const view = await this.requireView(workspaceId, projectId, userId, viewId);

    if (!hasAtLeastRole(role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'You cannot change this project’s default view.');
    }

    if (view.scope === ProjectViewScope.PERSONAL) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'A personal view cannot be the default for everyone.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.projectView.updateMany({
        where: { projectId, type: view.type, isDefault: true },
        data: { isDefault: false },
      });

      return tx.projectView.update({ where: { id: viewId }, data: { isDefault: true } });
    });

    return toViewDto(updated);
  }

  async remove(
    workspaceId: string,
    projectId: string,
    userId: string,
    role: WorkspaceRole,
    viewId: string,
  ): Promise<{ deleted: true }> {
    const view = await this.requireView(workspaceId, projectId, userId, viewId);
    this.assertMayEdit(view, userId, role);

    // The default is what a project opens on. Deleting it would leave the next
    // visitor with nothing to land on, so it has to be reassigned first.
    if (view.isDefault) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Make another view the default before deleting this one.',
      );
    }

    await this.prisma.projectView.delete({ where: { id: viewId } });
    return { deleted: true };
  }

  /**
   * Creates the List and Board defaults if the project has none.
   *
   * Idempotent by construction: it counts first and only creates what is
   * missing, so concurrent calls converge and a re-run does nothing.
   */
  async ensureDefaults(workspaceId: string, projectId: string): Promise<void> {
    const existing = await this.prisma.projectView.findMany({
      where: { projectId, scope: ProjectViewScope.PROJECT },
      select: { type: true },
    });

    const present = new Set(existing.map((view) => view.type));
    const missing = [ProjectViewType.LIST, ProjectViewType.BOARD].filter(
      (type) => !present.has(type),
    );

    if (missing.length === 0) return;

    await this.prisma.projectView.createMany({
      data: missing.map((type, index) => ({
        workspaceId,
        projectId,
        name: type === ProjectViewType.LIST ? 'List' : 'Board',
        type,
        scope: ProjectViewScope.PROJECT,
        isDefault: true,
        position: index,
        settings: defaultSettings(type) as unknown as Prisma.InputJsonValue,
      })),
      // Two requests can race here; the loser simply adds nothing.
      skipDuplicates: true,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requireView(
    workspaceId: string,
    projectId: string,
    userId: string,
    viewId: string,
  ): Promise<PrismaProjectView> {
    const view = await this.prisma.projectView.findFirst({
      where: {
        id: viewId,
        projectId,
        workspaceId,
        // Someone else's personal view is a 404, not a 403: telling the caller
        // it exists is already more than they should know.
        OR: [{ scope: ProjectViewScope.PROJECT }, { ownerUserId: userId }],
      },
    });

    if (!view) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'View not found.');
    }

    return view;
  }

  /** A personal view is the caller's alone; a shared one needs MEMBER. */
  private assertMayWriteScope(scope: ProjectViewScope, role: WorkspaceRole): void {
    if (scope === ProjectViewScope.PERSONAL) return;

    if (!hasAtLeastRole(role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Guests can create personal views, but not views for the whole project.',
      );
    }
  }

  private assertMayEdit(view: PrismaProjectView, userId: string, role: WorkspaceRole): void {
    if (view.scope === ProjectViewScope.PERSONAL) {
      if (view.ownerUserId !== userId) {
        throw AppException.notFound('RESOURCE_NOT_FOUND', 'View not found.');
      }
      return;
    }

    if (!hasAtLeastRole(role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'You cannot change a shared view.');
    }
  }
}

/**
 * Parses stored or incoming settings, filling defaults.
 *
 * Runs on read as well as write, because a document written by an older version
 * will be missing whatever was added since — and a view that fails to load is a
 * worse outcome than one that opens with a default column set.
 */
function parseSettings(input: unknown, type: ProjectViewType): Prisma.InputJsonValue {
  const parsed = viewSettingsSchema.safeParse(input ?? {});

  if (!parsed.success) {
    throw AppException.badRequest('BAD_REQUEST', 'Those view settings are not valid.', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const settings = parsed.data;

  if (settings.columns.length === 0) {
    return { ...settings, columns: defaultColumns(type) } as unknown as Prisma.InputJsonValue;
  }

  return settings as unknown as Prisma.InputJsonValue;
}

function defaultColumns(type: ProjectViewType) {
  return type === ProjectViewType.LIST ? DEFAULT_LIST_COLUMNS.map((field) => ({ field })) : [];
}

function defaultSettings(type: ProjectViewType): ViewSettings {
  return {
    columns: defaultColumns(type),
    filters: { combinator: 'AND', conditions: [] },
    sorts: [],
    // A Board groups by section, which is what the existing board already does.
    groupBy: type === ProjectViewType.BOARD ? SystemField.SECTION : null,
    density: 'COMFORTABLE',
    showCompleted: true,
  };
}

function toViewDto(view: PrismaProjectView): ProjectView {
  return {
    id: view.id,
    projectId: view.projectId,
    name: view.name,
    type: view.type,
    scope: view.scope,
    ownerUserId: view.ownerUserId,
    isDefault: view.isDefault,
    isFavorite: view.isFavorite,
    position: view.position,
    // Re-parsed on the way out so a client never receives a shape its types say
    // is impossible.
    settings: viewSettingsSchema.parse(view.settings ?? {}) as ViewSettings,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

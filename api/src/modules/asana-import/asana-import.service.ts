import type {
  AsanaImportStatus,
  ImportRun as ImportRunDto,
  ImportTargetWorkspace,
  StartAsanaImportResult,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { ImportRunStatus, ImportSource, type ImportRun, type User } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ImportQueue } from '../../jobs/import/import.queue';
import { AsanaApiClient, AsanaApiError } from '../../integrations/asana/asana-api.client';
import type {
  AsanaWorkspace,
  AsanaWorkspaceMembership,
} from '../../integrations/asana/asana.types';
import { WorkspacesService } from '../workspaces/workspaces.service';

import { LIMITS, clip } from './asana-mapping';

/** How long Asana's workspace and member list are trusted before asking again. */
const DIRECTORY_TTL_MS = 5 * 60_000;
/** A run that has not written progress for this long has lost its worker. */
const STALE_RUN_MS = 15 * 60_000;
/** Runs listed on the page. */
const RUN_HISTORY = 10;

type RunWithStarter = ImportRun & { startedBy: Pick<User, 'id' | 'name'> | null };

interface AsanaDirectory {
  workspace: AsanaWorkspace;
  /** Lower-cased e-mails of active, non-guest members. */
  members: Set<string>;
}

/**
 * Starting an Asana import and reporting on it. The import itself runs in the
 * worker (`AsanaImporter`); this side decides who may start one, where it
 * goes, and makes sure only one runs at a time.
 *
 * The token is the server's, not a workspace's, so the rule for who may use
 * it is Asana's own: a person whose e-mail is a full member of the Asana
 * workspace it reads. Anyone else on this server never sees that data.
 */
@Injectable()
export class AsanaImportService {
  private readonly logger = new Logger(AsanaImportService.name);
  private directory: { at: number; value: AsanaDirectory } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly asana: AsanaApiClient,
    private readonly workspaces: WorkspacesService,
    private readonly queue: ImportQueue,
  ) {}

  async status(workspaceId: string, userId: string): Promise<AsanaImportStatus> {
    const runs = await this.prisma.importRun.findMany({
      where: { workspaceId, source: ImportSource.ASANA },
      include: { startedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: RUN_HISTORY,
    });
    const base = { runs: runs.map(toRunDto), target: null, isTarget: false };

    const missing = this.missingSettings();
    if (missing.length > 0) {
      return {
        ...base,
        configured: false,
        missing,
        asanaWorkspace: null,
        eligible: false,
        reason: `Set ${missing.join(' and ')} in the server's environment.`,
      };
    }

    let directory: AsanaDirectory;
    try {
      directory = await this.loadDirectory();
    } catch (error) {
      return {
        ...base,
        configured: true,
        missing: [],
        asanaWorkspace: null,
        eligible: false,
        reason: `Asana did not answer: ${describe(error)}`,
      };
    }

    const [eligible, target] = await Promise.all([
      this.isAsanaMember(userId, directory),
      this.targetFor(directory.workspace.gid, userId),
    ]);

    return {
      ...base,
      configured: true,
      missing: [],
      asanaWorkspace: { gid: directory.workspace.gid, name: directory.workspace.name ?? 'Asana' },
      eligible,
      reason: eligible
        ? null
        : `Only people in the Asana workspace "${directory.workspace.name}" may import it, and your e-mail is not among its members.`,
      target,
      isTarget: target?.id === workspaceId,
    };
  }

  /**
   * The first import makes a new workspace, owned by whoever started it, so
   * nothing already in CoreTask is touched. Every later run syncs into that
   * same workspace and must be started from it.
   */
  async start(workspaceId: string, userId: string): Promise<StartAsanaImportResult> {
    if (this.missingSettings().length > 0) throw AppException.badRequest('ASANA_NOT_CONFIGURED');

    const directory = await this.loadDirectory().catch((error: unknown) => {
      throw AppException.serviceUnavailable(
        'SERVICE_UNAVAILABLE',
        `Asana did not answer: ${describe(error)}`,
      );
    });
    if (!(await this.isAsanaMember(userId, directory))) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only members of the Asana workspace may import it.',
      );
    }

    const gid = directory.workspace.gid;
    const previous = await this.prisma.importRun.findFirst({
      where: { source: ImportSource.ASANA, externalWorkspaceId: gid },
      orderBy: { createdAt: 'desc' },
      include: { workspace: { select: { id: true, name: true, slug: true, archivedAt: true } } },
    });

    let target: ImportTargetWorkspace;
    if (previous && !previous.workspace.archivedAt) {
      if (previous.workspaceId !== workspaceId) {
        throw AppException.conflict(
          'RESOURCE_CONFLICT',
          `This Asana workspace is already imported into "${previous.workspace.name}". Sync it again from there.`,
          { workspaceSlug: previous.workspace.slug },
        );
      }
      await this.assertNoneRunning(workspaceId);
      target = previous.workspace;
    } else {
      const name = clip(`${directory.workspace.name ?? 'Asana'} (Asana)`, LIMITS.workspaceName);
      const created = await this.workspaces.create(userId, { name });
      target = { id: created.id, name: created.name, slug: created.slug };
    }

    const run = await this.prisma.importRun.create({
      data: {
        workspaceId: target.id,
        source: ImportSource.ASANA,
        externalWorkspaceId: gid,
        startedById: userId,
      },
      include: { startedBy: { select: { id: true, name: true } } },
    });

    try {
      await this.queue.enqueueAsana(run.id);
    } catch (error) {
      await this.prisma.importRun.update({
        where: { id: run.id },
        data: {
          status: ImportRunStatus.FAILED,
          finishedAt: new Date(),
          errorCount: 1,
          errors: [
            {
              kind: 'run',
              externalId: null,
              name: null,
              message: 'The import could not be queued.',
            },
          ],
        },
      });
      this.logger.error({ err: error, runId: run.id }, 'Could not enqueue an Asana import');
      throw AppException.serviceUnavailable(
        'SERVICE_UNAVAILABLE',
        'The import could not be queued.',
      );
    }

    this.logger.log({ runId: run.id, workspaceId: target.id, userId }, 'Asana import queued');
    return { run: toRunDto(run), workspace: target };
  }

  async run(workspaceId: string, runId: string): Promise<ImportRunDto> {
    const run = await this.prisma.importRun.findFirst({
      where: { id: runId, workspaceId },
      include: { startedBy: { select: { id: true, name: true } } },
    });
    if (!run) throw AppException.notFound();
    return toRunDto(run);
  }

  private missingSettings(): string[] {
    const { accessToken, workspaceGid } = this.config.asana;
    return [
      ...(accessToken ? [] : ['ASANA_ACCESS_TOKEN']),
      ...(workspaceGid ? [] : ['ASANA_WORKSPACE_ID']),
    ];
  }

  /**
   * One run per workspace at a time. A run whose worker died stops writing
   * progress; past the stale mark it is closed as failed so another can start.
   */
  private async assertNoneRunning(workspaceId: string): Promise<void> {
    const active = await this.prisma.importRun.findFirst({
      where: {
        workspaceId,
        status: { in: [ImportRunStatus.QUEUED, ImportRunStatus.RUNNING] },
      },
    });
    if (!active) return;

    if (Date.now() - active.updatedAt.getTime() < STALE_RUN_MS) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'An Asana import is already running here.');
    }
    await this.prisma.importRun.update({
      where: { id: active.id },
      data: {
        status: ImportRunStatus.FAILED,
        finishedAt: new Date(),
        errorCount: active.errorCount + 1,
        errors: [
          ...(Array.isArray(active.errors) ? active.errors : []),
          {
            kind: 'run',
            externalId: null,
            name: null,
            message: 'The worker stopped before finishing.',
          },
        ],
      },
    });
  }

  private async loadDirectory(): Promise<AsanaDirectory> {
    if (this.directory && Date.now() - this.directory.at < DIRECTORY_TTL_MS) {
      return this.directory.value;
    }

    const gid = this.config.asana.workspaceGid as string;
    const [workspace, memberships] = await Promise.all([
      this.asana.get<AsanaWorkspace>(`/workspaces/${gid}`, { opt_fields: 'name,is_organization' }),
      this.asana.list<AsanaWorkspaceMembership>(`/workspaces/${gid}/workspace_memberships`, {
        opt_fields: 'user.email,is_guest,is_active',
      }),
    ]);
    const members = new Set(
      memberships
        .filter((m) => !m.is_guest && m.is_active !== false && m.user?.email)
        .map((m) => (m.user?.email as string).toLowerCase()),
    );

    const value = { workspace, members };
    this.directory = { at: Date.now(), value };
    return value;
  }

  private async isAsanaMember(userId: string, directory: AsanaDirectory): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return Boolean(user && directory.members.has(user.email.toLowerCase()));
  }

  /** The workspace holding this Asana's import, when the viewer is in it. */
  private async targetFor(gid: string, userId: string): Promise<ImportTargetWorkspace | null> {
    const run = await this.prisma.importRun.findFirst({
      where: {
        source: ImportSource.ASANA,
        externalWorkspaceId: gid,
        workspace: { archivedAt: null, members: { some: { userId } } },
      },
      orderBy: { createdAt: 'desc' },
      select: { workspace: { select: { id: true, name: true, slug: true } } },
    });
    return run?.workspace ?? null;
  }
}

export function toRunDto(run: RunWithStarter): ImportRunDto {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    status: run.status,
    phase: run.phase,
    counts: (run.counts ?? {}) as ImportRunDto['counts'],
    errors: (Array.isArray(run.errors) ? run.errors : []) as unknown as ImportRunDto['errors'],
    errorCount: run.errorCount,
    startedBy: run.startedBy,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

function describe(error: unknown): string {
  if (error instanceof AsanaApiError) return error.message;
  return error instanceof Error ? error.message : 'unknown error';
}

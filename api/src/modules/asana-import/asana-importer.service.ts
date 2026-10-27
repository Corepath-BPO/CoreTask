import { Injectable, Logger } from '@nestjs/common';
import { ImportRunStatus, type Prisma } from '@prisma/client';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { AsanaApiClient } from '../../integrations/asana/asana-api.client';
import { StorageService } from '../../integrations/storage/storage.service';

import { AsanaImportRun, MAX_RECORDED_ERRORS } from './asana-import-run';

/** Statuses a run does not leave; a job for one is a stale duplicate. */
const FINISHED: ImportRunStatus[] = [
  ImportRunStatus.SUCCEEDED,
  ImportRunStatus.PARTIAL,
  ImportRunStatus.FAILED,
];

/**
 * The worker side of the Asana import: runs one queued run to the end and
 * leaves its outcome on the run row, whatever happens.
 */
@Injectable()
export class AsanaImporter {
  private readonly logger = new Logger(AsanaImporter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly asana: AsanaApiClient,
    private readonly storage: StorageService,
  ) {}

  async run(runId: string): Promise<ImportRunStatus | null> {
    const run = await this.prisma.importRun.findUnique({
      where: { id: runId },
      include: { workspace: { select: { createdById: true } } },
    });
    if (!run || FINISHED.includes(run.status)) return null;

    if (!this.config.asana.enabled) {
      await this.finish(runId, ImportRunStatus.FAILED, {
        errors: [runError('ASANA_ACCESS_TOKEN or ASANA_WORKSPACE_ID is not set on the worker.')],
        errorCount: 1,
      });
      return ImportRunStatus.FAILED;
    }

    await this.prisma.importRun.update({
      where: { id: runId },
      data: { status: ImportRunStatus.RUNNING, startedAt: new Date(), finishedAt: null },
    });
    this.logger.log({ runId, workspaceId: run.workspaceId }, 'Asana import started');

    const job = new AsanaImportRun(
      {
        prisma: this.prisma,
        asana: this.asana,
        storage: this.storage,
        logger: this.logger,
        concurrency: this.config.asana.concurrency,
      },
      run.id,
      run.workspaceId,
      run.externalWorkspaceId,
      run.startedById ?? run.workspace.createdById,
    );

    try {
      const status = await job.execute();
      const snapshot = job.snapshot();
      await this.finish(runId, status, {
        phase: snapshot.phase,
        counts: snapshot.counts as Prisma.InputJsonValue,
        errors: snapshot.errors as unknown as Prisma.InputJsonValue,
        errorCount: snapshot.errorCount,
      });
      this.logger.log({ runId, status, errors: snapshot.errorCount }, 'Asana import finished');
      return status;
    } catch (error) {
      const snapshot = job.snapshot();
      const message = error instanceof Error ? error.message : String(error);
      await this.finish(runId, ImportRunStatus.FAILED, {
        counts: snapshot.counts as Prisma.InputJsonValue,
        errors: [
          ...snapshot.errors.slice(0, MAX_RECORDED_ERRORS - 1),
          runError(message),
        ] as unknown as Prisma.InputJsonValue,
        errorCount: snapshot.errorCount + 1,
      });
      this.logger.error({ err: error, runId }, 'Asana import failed');
      return ImportRunStatus.FAILED;
    }
  }

  private async finish(
    runId: string,
    status: ImportRunStatus,
    data: Omit<Prisma.ImportRunUpdateInput, 'status' | 'finishedAt'>,
  ): Promise<void> {
    await this.prisma.importRun.update({
      where: { id: runId },
      data: { ...data, status, finishedAt: new Date() },
    });
  }
}

function runError(message: string) {
  return { kind: 'run', externalId: null, name: null, message: message.slice(0, 500) };
}

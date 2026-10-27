import { randomUUID } from 'node:crypto';

import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../../database/prisma.service';
import type { AsanaApiClient } from '../../integrations/asana/asana-api.client';
import type { ImportQueue } from '../../jobs/import/import.queue';
import type { WorkspacesService } from '../workspaces/workspaces.service';

import { AsanaImportService } from './asana-import.service';

type Run = {
  id: string;
  workspaceId: string;
  status: string;
  updatedAt: Date;
  errorCount: number;
  errors: unknown[];
  createdAt: Date;
  startedBy: null;
};

interface RunWhere {
  workspaceId: string;
  status?: { in: string[] };
  updatedAt?: { lt: Date };
}

/** Just the run queries the status read makes, with the two filters the dead-run query uses. */
function fakeRuns(runs: Run[]) {
  const findMany = jest.fn(async ({ where }: { where: RunWhere }) =>
    runs.filter(
      (run) =>
        run.workspaceId === where.workspaceId &&
        (!where.status || where.status.in.includes(run.status)) &&
        (!where.updatedAt || run.updatedAt < where.updatedAt.lt),
    ),
  );
  const update = jest.fn(async ({ where, data }: { where: { id: string }; data: object }) =>
    Object.assign(runs.find((run) => run.id === where.id) as Run, data),
  );
  return { importRun: { findMany, update } };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

function run(workspaceId: string, updatedAt: Date): Run {
  return {
    id: randomUUID(),
    workspaceId,
    status: 'RUNNING',
    updatedAt,
    errorCount: 0,
    errors: [],
    createdAt: updatedAt,
    startedBy: null,
  };
}

function service(prisma: object) {
  // Unconfigured, so the status read stops before it would ask Asana anything.
  const config = { asana: { accessToken: undefined, workspaceGid: undefined } };
  return new AsanaImportService(
    prisma as unknown as PrismaService,
    config as unknown as AppConfigService,
    {} as AsanaApiClient,
    {} as WorkspacesService,
    {} as ImportQueue,
  );
}

describe('AsanaImportService', () => {
  it('closes a run whose worker died when the page reads the status', async () => {
    const workspaceId = randomUUID();
    const dead = run(workspaceId, minutesAgo(20));
    const prisma = fakeRuns([dead]);

    const status = await service(prisma).status(workspaceId, randomUUID());

    expect(dead.status).toBe('FAILED');
    expect(dead.errors).toEqual([
      expect.objectContaining({ kind: 'run', message: 'The worker stopped before finishing.' }),
    ]);
    // The page sees it closed, so "Sync again" is offered again.
    expect(status.runs[0]?.status).toBe('FAILED');
  });

  it('leaves a run that is still writing progress alone', async () => {
    const workspaceId = randomUUID();
    const live = run(workspaceId, minutesAgo(1));
    const prisma = fakeRuns([live]);

    await service(prisma).status(workspaceId, randomUUID());

    expect(live.status).toBe('RUNNING');
    expect(prisma.importRun.update).not.toHaveBeenCalled();
  });
});

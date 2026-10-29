import { ServerEvent, WorkItemType } from '@coretask/contracts';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ImportRunStatus, ImportSource, type AsanaLiveSync } from '@prisma/client';
import type { Queue } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { AsanaApiClient, AsanaApiError } from '../../integrations/asana/asana-api.client';
import type { AsanaEvent } from '../../integrations/asana/asana.types';
import { StorageService } from '../../integrations/storage/storage.service';
import { ImportJob, QueueName, type ImportJobData } from '../../jobs/queue-names';
import { RealtimeRelayPublisher } from '../../websocket/realtime-relay.publisher';

import {
  AsanaImportRun,
  pool,
  readableError,
  type DefinitionChanges,
  type LiveChange,
} from './asana-import-run';
import { addWork, emptyWork } from './asana-live-events';

/** A run that has written nothing for this long has lost its worker. */
const STALE_RUN_MS = 15 * 60_000;
/** Event pages read per stream in one tick; Asana sends 100 to a page. */
const MAX_PAGES = 20;
/** Past this many changes in one project, one "the list changed" instead of one per task. */
const ANNOUNCE_EACH_UP_TO = 25;

interface Prepared {
  run: AsanaImportRun;
  /** When it read the refs; a full run that finished later changed them. */
  at: Date;
}

/**
 * Live sync from Asana: every tick, each imported project's Asana event
 * stream is read from where the last tick left it, and the tasks the events
 * name are read again and written the way a full run writes them.
 *
 * It runs on the import queue, whose one-at-a-time worker keeps it from ever
 * writing alongside a full run: a tick waits for a run, and a run for a tick.
 *
 * Asana's events are at-most-once and a stream's token lapses after 24
 * hours, so a full Sync again backs it up: when live sync is switched on
 * (after the streams have their tokens, so nothing during the run is lost),
 * whenever a token has lapsed, and nightly.
 *
 * Like the import, it writes straight to the database: Asana's own rules have
 * already run on these changes, so none of CoreTask's fire, and nobody is
 * notified. Open boards are told, through the realtime relay.
 */
@Injectable()
export class AsanaLiveSyncService {
  private readonly logger = new Logger(AsanaLiveSyncService.name);
  private readonly prepared = new Map<string, Prepared>();
  /** When each workspace's fields, tags and projects were last looked at. */
  private readonly definitionsAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly asana: AsanaApiClient,
    private readonly storage: StorageService,
    private readonly relay: RealtimeRelayPublisher,
    @InjectQueue(QueueName.IMPORT) private readonly queue: Queue,
  ) {}

  async tick(): Promise<{ workspaces: number; changes: number }> {
    if (!this.config.asana.enabled) return { workspaces: 0, changes: 0 };

    const syncs = await this.prisma.asanaLiveSync.findMany({ where: { enabled: true } });
    let changes = 0;
    for (const sync of syncs) {
      try {
        changes += await this.syncWorkspace(sync);
      } catch (error) {
        this.logger.error({ err: error, workspaceId: sync.workspaceId }, 'Asana live sync failed');
        await this.prisma.asanaLiveSync.update({
          where: { workspaceId: sync.workspaceId },
          data: { lastPolledAt: new Date(), lastError: clipError(readableError(error)) },
        });
      }
    }
    return { workspaces: syncs.length, changes };
  }

  /** Nightly: every workspace live syncing gets a full Sync again on its next tick. */
  async requestNightlyRuns(): Promise<number> {
    const { count } = await this.prisma.asanaLiveSync.updateMany({
      where: { enabled: true },
      data: { needsFullSync: true },
    });
    return count;
  }

  private async syncWorkspace(sync: AsanaLiveSync): Promise<number> {
    const { workspaceId } = sync;

    const active = await this.prisma.importRun.findFirst({
      where: {
        workspaceId,
        status: { in: [ImportRunStatus.QUEUED, ImportRunStatus.RUNNING] },
        updatedAt: { gt: new Date(Date.now() - STALE_RUN_MS) },
      },
      select: { id: true },
    });
    // A full run is due next on this queue; what changes meanwhile is read after it.
    if (active) return 0;

    const lastRun = await this.prisma.importRun.findFirst({
      where: { workspaceId, source: ImportSource.ASANA, finishedAt: { not: null } },
      orderBy: { finishedAt: 'desc' },
      include: { workspace: { select: { createdById: true } } },
    });
    // Nothing imported yet: live sync follows an import, it does not make one.
    if (!lastRun) return 0;

    const run = await this.runFor(sync, lastRun);
    const streams = await this.readStreams(workspaceId, run.liveProjectGids());

    if (sync.needsFullSync || streams.lapsed) {
      await this.startFullRun(sync, lastRun.externalWorkspaceId);
      return 0;
    }

    const work = emptyWork();
    for (const [projectGid, events] of streams.events) addWork(work, projectGid, events);
    await this.findStoryTasks(work.stories, work.tasks, work.history, work.deletedStories);

    for (const projectGid of work.sections) await run.syncSections(projectGid);
    const changes = work.tasks.size > 0 ? await run.syncTasks([...work.tasks], work.history) : [];
    if (work.deletedStories.size > 0) {
      changes.push(...(await run.removeComments([...work.deletedStories])));
    }
    await this.announce(workspaceId, changes, work.sections, run);

    const updated: string[] = [];
    for (const [projectGid, parts] of work.projects) {
      const projectId = await run.syncProject(projectGid, parts);
      if (projectId) updated.push(projectId);
    }
    const definitions = this.definitionsDue(workspaceId)
      ? await run.syncDefinitions((projectGid) => this.openStream(workspaceId, projectGid))
      : null;
    const count = changes.length + (await this.announceProjects(workspaceId, updated, definitions));

    const failures = run.takeFailures();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const sameDay = sync.countedOn?.toISOString().slice(0, 10) === today;
    await this.prisma.asanaLiveSync.update({
      where: { workspaceId },
      data: {
        lastPolledAt: now,
        ...(count > 0
          ? {
              lastChangeAt: now,
              changesToday: (sameDay ? sync.changesToday : 0) + count,
              countedOn: new Date(today),
            }
          : {}),
        lastError: failures[0]
          ? clipError(`${failures[0].name ?? failures[0].externalId}: ${failures[0].message}`)
          : null,
      },
    });
    if (count > 0 || failures.length > 0) {
      this.logger.log(
        { workspaceId, changes: count, failures: failures.length },
        'Asana live sync applied changes',
      );
    }
    return count;
  }

  /** The workspace's prepared run, made again when a full run has changed the refs since. */
  private async runFor(
    sync: AsanaLiveSync,
    lastRun: {
      finishedAt: Date | null;
      externalWorkspaceId: string;
      startedById: string | null;
      workspace: { createdById: string };
    },
  ): Promise<AsanaImportRun> {
    const cached = this.prepared.get(sync.workspaceId);
    if (cached && lastRun.finishedAt && cached.at >= lastRun.finishedAt) return cached.run;

    const run = new AsanaImportRun(
      {
        prisma: this.prisma,
        asana: this.asana,
        storage: this.storage,
        logger: this.logger,
        concurrency: this.config.asana.concurrency,
      },
      null,
      sync.workspaceId,
      lastRun.externalWorkspaceId,
      sync.enabledById ?? lastRun.startedById ?? lastRun.workspace.createdById,
    );
    const at = new Date();
    await run.prepareLive();
    this.prepared.set(sync.workspaceId, { run, at });
    return run;
  }

  /**
   * Every project's events since its last token. A project without a token
   * gets one, which starts its stream now. A lapsed token means events were
   * missed, which only a full run can make up.
   */
  private async readStreams(
    workspaceId: string,
    projectGids: string[],
  ): Promise<{ events: Map<string, AsanaEvent[]>; lapsed: boolean }> {
    const rows = await this.prisma.asanaEventStream.findMany({ where: { workspaceId } });
    const tokens = new Map(rows.map((row) => [row.projectGid, row.syncToken]));
    const events = new Map<string, AsanaEvent[]>();
    let lapsed = false;

    await pool(projectGids, Math.min(this.config.asana.concurrency, 5), async (projectGid) => {
      const known = tokens.get(projectGid) ?? null;
      let token = known;
      const read: AsanaEvent[] = [];
      try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const answer = await this.asana.events(projectGid, token);
          token = answer.sync;
          if (answer.lapsed) {
            if (known) lapsed = true;
            break;
          }
          read.push(...answer.events);
          if (!answer.hasMore) break;
        }
      } catch (error) {
        // A project Asana no longer shows this token (deleted, made private)
        // has nothing to read; the next full run settles it.
        if (error instanceof AsanaApiError && (error.status === 403 || error.status === 404))
          return;
        throw error;
      }
      if (read.length > 0) events.set(projectGid, read);
      if (token !== known) {
        await this.prisma.asanaEventStream.upsert({
          where: { workspaceId_projectGid: { workspaceId, projectGid } },
          create: { workspaceId, projectGid, syncToken: token },
          update: { syncToken: token },
        });
      }
    });
    return { events, lapsed };
  }

  /** Whether a workspace's fields, tags and projects are due a look; marks them looked at. */
  private definitionsDue(workspaceId: string): boolean {
    const every = this.config.asana.liveDefinitionsIntervalMs;
    if (!every) return false;
    const last = this.definitionsAt.get(workspaceId);
    if (last !== undefined && Date.now() - last < every) return false;
    this.definitionsAt.set(workspaceId, Date.now());
    return true;
  }

  /** A new project's event stream, opened before its tasks are read. */
  private async openStream(workspaceId: string, projectGid: string): Promise<void> {
    const answer = await this.asana.events(projectGid, null);
    await this.prisma.asanaEventStream.upsert({
      where: { workspaceId_projectGid: { workspaceId, projectGid } },
      create: { workspaceId, projectGid, syncToken: answer.sync },
      update: { syncToken: answer.sync },
    });
  }

  /** The tasks of comments whose events did not say; one Asana no longer has was deleted. */
  private async findStoryTasks(
    stories: Set<string>,
    tasks: Set<string>,
    history: Set<string>,
    deleted: Set<string>,
  ): Promise<void> {
    await pool([...stories], 5, async (gid) => {
      try {
        const story = await this.asana.get<{ target?: { gid: string } | null }>(`/stories/${gid}`, {
          opt_fields: 'target',
        });
        if (story.target?.gid) {
          tasks.add(story.target.gid);
          history.add(story.target.gid);
        }
      } catch (error) {
        // Deleted since it was written: deleted here too.
        if (error instanceof AsanaApiError && error.status === 404) deleted.add(gid);
      }
    });
  }

  /**
   * A full Sync again, queued behind this tick. The streams already have
   * their tokens, so what changes while it runs is read after it.
   */
  private async startFullRun(sync: AsanaLiveSync, asanaWorkspaceGid: string): Promise<void> {
    const run = await this.prisma.importRun.create({
      data: {
        workspaceId: sync.workspaceId,
        source: ImportSource.ASANA,
        externalWorkspaceId: asanaWorkspaceGid,
        startedById: sync.enabledById,
      },
    });
    const data: ImportJobData = { runId: run.id };
    await this.queue.add(ImportJob.ASANA, data, {
      jobId: `asana-${run.id}`,
      attempts: 20,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 7 * 86_400 },
    });
    await this.prisma.asanaLiveSync.update({
      where: { workspaceId: sync.workspaceId },
      data: { needsFullSync: false, lastPolledAt: new Date() },
    });
    this.logger.log(
      { workspaceId: sync.workspaceId, runId: run.id },
      'Asana live sync queued a full run',
    );
  }

  /**
   * Projects that changed, told to whoever may see them, as a person's own
   * change is: a new one appears in lists and pickers, a changed one's page,
   * roster and fields refresh. A field's new definition reaches every project
   * using it. Returns how many, for the day's count.
   */
  private async announceProjects(
    workspaceId: string,
    updated: string[],
    definitions: DefinitionChanges | null,
  ): Promise<number> {
    const created = new Set(definitions?.createdProjectIds ?? []);
    const changed = new Set([...updated, ...(definitions?.updatedProjectIds ?? [])]);
    if (definitions && definitions.fieldIds.length > 0) {
      const using = await this.prisma.projectCustomField.findMany({
        where: { customFieldId: { in: definitions.fieldIds } },
        select: { projectId: true },
        distinct: ['projectId'],
      });
      for (const row of using) changed.add(row.projectId);
    }

    const occurredAt = new Date().toISOString();
    const projects = new Set([...created, ...changed]);
    for (const projectId of projects) {
      const event = created.has(projectId)
        ? ServerEvent.PROJECT_CREATED
        : ServerEvent.PROJECT_UPDATED;
      await this.relay.toProjectAudience(workspaceId, projectId, event, {
        workspaceId,
        projectId,
        id: projectId,
        occurredAt,
        source: 'asana',
      });
    }
    return projects.size;
  }

  /** Tells open boards, task panels and lists what changed. */
  private async announce(
    workspaceId: string,
    changes: LiveChange[],
    sectionProjects: Set<string>,
    run: AsanaImportRun,
  ): Promise<void> {
    const byProject = new Map<string, string[]>();
    for (const change of changes) {
      for (const projectId of change.projectIds) {
        byProject.set(projectId, [...(byProject.get(projectId) ?? []), change.taskId]);
      }
    }
    for (const projectGid of sectionProjects) {
      const projectId = run.projectIdOf(projectGid);
      if (projectId && !byProject.has(projectId)) byProject.set(projectId, []);
    }

    const occurredAt = new Date().toISOString();
    for (const [projectId, taskIds] of byProject) {
      const base = { workspaceId, projectId, occurredAt, source: 'asana' };
      if (taskIds.length === 0 || taskIds.length > ANNOUNCE_EACH_UP_TO) {
        await this.relay.toProjectAudience(
          workspaceId,
          projectId,
          ServerEvent.WORK_ITEM_UPDATED,
          base,
        );
        continue;
      }
      for (const taskId of new Set(taskIds)) {
        await this.relay.toProjectAudience(workspaceId, projectId, ServerEvent.WORK_ITEM_UPDATED, {
          ...base,
          workItemId: taskId,
          workItemType: WorkItemType.TASK,
        });
      }
    }
  }
}

function clipError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 499)}…` : message;
}

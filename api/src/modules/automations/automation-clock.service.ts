import { randomUUID } from 'node:crypto';

import {
  approachingDays,
  AutomationRuleStatus,
  AutomationTrigger,
  DATE_TRIGGERS,
  dateTriggerIsDue,
  dateTriggerWindow,
  ExecutionScope,
  isApproachingTrigger,
  isCustomDateTrigger,
  isDateTrigger,
  isTimeZone,
  latestOccurrence,
  MAX_SCHEDULED_TASKS_PER_RUN,
  readSchedule,
  type DateTrigger,
  type ScheduleConfig,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

import { AutomationEventPublisher, type AutomationEvent } from './automation-event.publisher';

/**
 * How late a scheduled run may start and still be worth running.
 *
 * A worker that was down over the weekend, or a rule paused through Monday
 * morning, should not fire Monday's 9am run at teatime — or a month of daily
 * runs at once. Missed by more than this, a run is passed over and the next
 * one is waited for.
 */
const SCHEDULE_GRACE_MS = 60 * 60_000;

/** A generous margin around the date filters, so the precise window test decides. */
const DAY_MS = 86_400_000;

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The clock the time-driven triggers hang from.
 *
 * Runs on the worker, once a minute. It never runs a rule itself: it decides
 * what has come due and publishes an event aimed at that one rule, so a timed
 * rule is executed — logged, loop-guarded, chained — exactly as a rule set off
 * by an edit is.
 *
 * Every decision is idempotent. A schedule is claimed by moving its cursor
 * with a compare-and-set, and a date firing is claimed by inserting a row with
 * a unique key, so two ticks overlapping — or a retry — cannot run anything
 * twice.
 */
@Injectable()
export class AutomationClockService {
  private readonly logger = new Logger(AutomationClockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: AutomationEventPublisher,
  ) {}

  /** One look at the clock. Returns how many events it published, for the log. */
  async tick(now = new Date()): Promise<{ scheduled: number; dated: number; resumed: number }> {
    const scheduled = await this.runSchedules(now);
    const dated = await this.runDateTriggers(now);
    const resumed = await this.runDelays(now);

    if (scheduled + dated + resumed > 0) {
      this.logger.log({ scheduled, dated, resumed }, 'Time-driven automations came due');
    }

    return { scheduled, dated, resumed };
  }

  // -------------------------------------------------------------------------
  // Wait steps
  // -------------------------------------------------------------------------

  /**
   * Runs that waited long enough, published again for their rule to pick up
   * after the Wait step. Claimed one by one with a compare-and-set, like a
   * schedule, so overlapping ticks cannot resume a run twice. A rule that has
   * stopped since — paused, disabled — has its waiting runs cancelled rather
   * than resumed later by surprise.
   */
  async runDelays(now: Date): Promise<number> {
    const due = await this.prisma.automationDelayedRun.findMany({
      where: { status: 'PENDING', runAt: { lte: now } },
      orderBy: { runAt: 'asc' },
      take: 200,
      select: {
        id: true,
        ruleId: true,
        nodeId: true,
        event: true,
        rule: { select: { status: true } },
      },
    });

    let resumed = 0;
    for (const run of due) {
      const live = run.rule.status === AutomationRuleStatus.ACTIVE;
      const claimed = await this.prisma.automationDelayedRun.updateMany({
        where: { id: run.id, status: 'PENDING' },
        data: { status: live ? 'DONE' : 'CANCELLED' },
      });
      if (claimed.count === 0 || !live) continue;

      const event = asRecord(run.event) as unknown as AutomationEvent;
      await this.publisher.publish({
        ...event,
        eventId: randomUUID(),
        ruleId: run.ruleId,
        resumeFromNodeId: run.nodeId,
      });
      resumed += 1;
    }
    return resumed;
  }

  // -------------------------------------------------------------------------
  // Scheduled time
  // -------------------------------------------------------------------------

  async runSchedules(now: Date): Promise<number> {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        status: AutomationRuleStatus.ACTIVE,
        triggerType: AutomationTrigger.SCHEDULED_TIME,
        project: { archivedAt: null },
      },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        triggerConfig: true,
        publishedAt: true,
        scheduleCursor: true,
      },
    });

    let published = 0;

    for (const rule of rules) {
      const schedule = readSchedule(asRecord(rule.triggerConfig));
      const due = latestOccurrence(schedule, now);

      // Owed only what came due after the rule went live, and after the run
      // it last made.
      const since = rule.scheduleCursor ?? rule.publishedAt;
      if (!due || !since || due.getTime() <= since.getTime()) continue;

      // Claimed before it is run: only the tick that moves the cursor runs it.
      const claimed = await this.prisma.automationRule.updateMany({
        where: {
          id: rule.id,
          OR: [{ scheduleCursor: null }, { scheduleCursor: { lt: due } }],
        },
        data: { scheduleCursor: due },
      });
      if (claimed.count === 0) continue;

      if (now.getTime() - due.getTime() > SCHEDULE_GRACE_MS) {
        this.logger.warn(
          { ruleId: rule.id, due: due.toISOString() },
          'Passed over a scheduled run that was missed by more than the grace period',
        );
        continue;
      }

      published += await this.runScheduled(rule, schedule, due, now);
    }

    return published;
  }

  /**
   * One scheduled run: an event per task in scope, or one about the project.
   *
   * The tasks share a correlation id, so the history reads them as one run.
   * The rule's conditions still apply to each — the scope says which tasks
   * are asked, and the conditions which of them answer.
   */
  private async runScheduled(
    rule: { id: string; workspaceId: string; projectId: string },
    schedule: ScheduleConfig,
    due: Date,
    now: Date,
  ): Promise<number> {
    const correlationId = randomUUID();
    const after = { scheduledFor: due.toISOString() };

    if (schedule.scope === ExecutionScope.NONE) {
      await this.publisher.publish({
        workspaceId: rule.workspaceId,
        projectId: rule.projectId,
        trigger: AutomationTrigger.SCHEDULED_TIME,
        entityType: 'PROJECT',
        entityId: rule.projectId,
        actorId: null,
        ruleId: rule.id,
        after,
        correlationId,
      });
      return 1;
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        archivedAt: null,
        parentTaskId: null,
        ...(schedule.scope === ExecutionScope.ALL ? {} : { completedAt: null }),
        // The project's tasks, home or linked in; a section is the home's
        // column or the link's.
        ...(schedule.scope === ExecutionScope.SECTION
          ? (() => {
              const sectionId = schedule.sectionId ?? '00000000-0000-0000-0000-000000000000';
              return {
                OR: [
                  { projectId: rule.projectId, sectionId },
                  { projectLinks: { some: { projectId: rule.projectId, sectionId } } },
                ],
              };
            })()
          : {
              OR: [
                { projectId: rule.projectId },
                { projectLinks: { some: { projectId: rule.projectId } } },
              ],
            }),
        ...(schedule.scope === ExecutionScope.STALE
          ? { updatedAt: { lt: new Date(now.getTime() - schedule.staleDays * DAY_MS) } }
          : {}),
      },
      orderBy: [{ sectionId: 'asc' }, { position: 'asc' }],
      take: MAX_SCHEDULED_TASKS_PER_RUN,
      select: { id: true },
    });

    for (const task of tasks) {
      await this.publisher.publish({
        workspaceId: rule.workspaceId,
        projectId: rule.projectId,
        trigger: AutomationTrigger.SCHEDULED_TIME,
        entityType: 'TASK',
        entityId: task.id,
        actorId: null,
        ruleId: rule.id,
        after,
        correlationId,
      });
    }

    return tasks.length;
  }

  // -------------------------------------------------------------------------
  // Due and start dates
  // -------------------------------------------------------------------------

  async runDateTriggers(now: Date): Promise<number> {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        status: AutomationRuleStatus.ACTIVE,
        triggerType: { in: [...DATE_TRIGGERS] },
        project: { archivedAt: null },
      },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        triggerType: true,
        triggerConfig: true,
        publishedAt: true,
      },
    });

    let published = 0;

    for (const rule of rules) {
      if (!rule.publishedAt || !isDateTrigger(rule.triggerType)) continue;

      const trigger = rule.triggerType;
      const config = asRecord(rule.triggerConfig);
      const days = isApproachingTrigger(trigger) ? approachingDays(config) : 0;
      const timeZone = isTimeZone(config['timezone']) ? config['timezone'] : 'UTC';
      const since = rule.publishedAt;

      /*
       * A coarse filter in SQL — dates a day or two either side of anything
       * that could be due — and the exact window in code, which knows the
       * rule's timezone and the task's due time.
       */
      const range = {
        gte: new Date(since.getTime() - 2 * DAY_MS),
        lte: new Date(now.getTime() + (days + 2) * DAY_MS),
      };
      const candidates = await this.dateCandidates(rule.projectId, trigger, config, range);

      const due = candidates.flatMap((task) => {
        const window = dateTriggerWindow(trigger, task, days, timeZone);
        return window && dateTriggerIsDue(window, now, since)
          ? [{ task, opensAt: window.opensAt }]
          : [];
      });
      if (due.length === 0) continue;

      // What this rule has already announced, so a window lasting days is
      // announced once rather than once a minute.
      const fired = await this.prisma.automationClockFiring.findMany({
        where: { ruleId: rule.id, taskId: { in: due.map((entry) => entry.task.id) } },
        select: { taskId: true, firedFor: true },
      });
      const seen = new Set(fired.map((row) => `${row.taskId}:${row.firedFor.toISOString()}`));

      for (const { task, opensAt } of due) {
        if (seen.has(`${task.id}:${opensAt.toISOString()}`)) continue;

        try {
          await this.prisma.automationClockFiring.create({
            data: { ruleId: rule.id, taskId: task.id, firedFor: opensAt },
          });
        } catch (error) {
          // Another tick got there first: it is announcing this one.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            continue;
          }
          throw error;
        }

        await this.publisher.publish({
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
          trigger,
          entityType: 'TASK',
          entityId: task.id,
          actorId: null,
          ruleId: rule.id,
          after: {
            dueDate: task.dueDate?.toISOString() ?? null,
            startDate: task.startDate?.toISOString() ?? null,
            ...(task.customDate !== undefined
              ? { fieldId: config['fieldId'], date: task.customDate?.toISOString() ?? null }
              : {}),
            days,
          },
        });
        published += 1;
      }
    }

    return published;
  }

  /**
   * The open tasks whose watched date falls in `range`: the task's own due or
   * start date, or — for the two custom-date triggers — the value of the field
   * the rule names, read from the field's own date index.
   */
  private async dateCandidates(
    projectId: string,
    trigger: DateTrigger,
    config: Record<string, unknown>,
    range: { gte: Date; lte: Date },
  ): Promise<
    {
      id: string;
      dueDate: Date | null;
      dueAt: Date | null;
      startDate: Date | null;
      customDate?: Date | null;
    }[]
  > {
    // Open tasks in the project, at home there or linked in.
    const open = {
      archivedAt: null,
      completedAt: null,
      OR: [{ projectId }, { projectLinks: { some: { projectId } } }],
    };
    const columns = { id: true, dueDate: true, dueAt: true, startDate: true } as const;

    if (isCustomDateTrigger(trigger)) {
      const fieldId = typeof config['fieldId'] === 'string' ? config['fieldId'] : null;
      if (!fieldId) return [];
      const values = await this.prisma.taskCustomFieldValue.findMany({
        where: { customFieldId: fieldId, dateValue: range, task: open },
        select: { dateValue: true, task: { select: columns } },
        take: 1_000,
      });
      return values.map((value) => ({ ...value.task, customDate: value.dateValue }));
    }

    const column =
      trigger === AutomationTrigger.START_DATE_APPROACHING ||
      trigger === AutomationTrigger.START_DATE_PASSED
        ? 'startDate'
        : 'dueDate';
    return this.prisma.task.findMany({
      where: { ...open, [column]: range },
      select: columns,
      take: 1_000,
    });
  }
}

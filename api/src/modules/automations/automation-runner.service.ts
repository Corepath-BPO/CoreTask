import { randomUUID } from 'node:crypto';

import {
  ActivityAction,
  ActivityEntity,
  AutomationAction,
  AutomationExecutionStatus,
  AutomationNodeType,
  AutomationRuleStatus,
  BLOCK_SELF_RETRIGGER,
  BranchKey,
  FilterOperator,
  MAX_ACTIONS_PER_CHAIN,
  MAX_ACTIONS_PER_EXECUTION,
  MAX_AUTOMATION_DEPTH,
  AUTOMATION_VALUE_TOKEN,
  isTokenValue,
  NotificationType,
  POSITION_STEP,
  PROJECT_STATUS_LABEL,
  webhookExtraFields,
  ServerEvent,
  isCalendarDate,
  isWeekday,
  dayNextWeek,
  aiDecidesSubtasks,
  subtaskEntries,
  toFilterOperator,
  isDirectOperator,
  AutomationTrigger,
  isComputedFieldType,
  isTimeZone,
  renderAutomationText,
  TASK_TITLE_MAX_LENGTH,
  TRIGGER_CONFIG_FORM,
  type AutomationTextVariable,
  type CustomFieldStoryMetadata,
  type CustomFieldType,
  type SubtaskEntry,
  TASK_KINDS,
  type TaskKind,
  AUTOMATION_EMAIL_SUBJECT_MAX,
  AutomationEmailRecipient,
  MAX_EMAIL_RECIPIENTS,
  emailRecipientsOf,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  isTicketTrigger,
  ticketConditionHolds,
  isTicketConditionField,
  delayMs,
  describeDelay,
  AI_CHECK_FIELD,
  evaluateCondition,
  CHECKLIST_NAME_MAX,
  MAX_CHECKLISTS_PER_TASK,
  checklistOf,
  WorkItemType,
} from '@coretask/contracts';
import type { TaskCustomFieldValue as TaskCustomFieldValueDto } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  StatusCategory,
  TaskStatus,
  WorkspaceRole,
  type Task,
  type TaskCustomFieldValue,
} from '@prisma/client';

import { appendPosition } from '../../common/utils/position.util';
import { plainTextToHtml } from '../../common/utils/rich-text.util';
import { toCalendarDate } from '../../common/utils/schedule.util';
import { PrismaService } from '../../database/prisma.service';
import { AiUnavailableError } from '../../integrations/ai/ai-client';
import { RealtimeRelayPublisher } from '../../websocket/realtime-relay.publisher';
import { diffItemStories, snapshotFromTask } from '../activity-logs/item-stories';
import { toValueDto } from '../custom-fields/custom-field-value.mapper';
import { FormulaValuesService } from '../custom-fields/formula-values.service';
import { labelValue } from '../custom-fields/lib/value-labels';
import { assignableIds, isAssignable } from '../project-access/assignable';

import { completionData, priorityData, readActionId, statusData } from './action-config';
import type { RuleEmailRequest, RuleWebhookRequest } from '../../jobs/queue-names';

import { AutomationAiService } from './automation-ai.service';
import {
  chainOf,
  derivedEventId,
  runKey,
  type AutomationEvent,
} from './automation-event.publisher';
import { directComparison, numberComparison } from './condition-comparison';
import { dropLinkToHome, endOfSection, leaveHome } from '../tasks/task-projects';
import { spawnNextOccurrence } from '../tasks/task-recurrence';
import { ticketLifecycle } from '../tickets/ticket-lifecycle';

import { fieldChangeTriggers } from './task-field-triggers';
import { readSnapshot, type SnapshotNode } from './versions/rule-snapshot';

/**
 * A step as the runner reads it: from the published version's copy of the
 * rule, never from the rows the builder is editing.
 */
type AutomationNode = SnapshotNode;

/** Why "Assign to" did nothing: the person is not someone this project's work may go to. */
const NOT_A_PROJECT_MEMBER = 'That person is not a member of this project.';

/** What one action attempt produced, for the log. */
interface ActionOutcome {
  succeeded: boolean;
  message?: string;
  before?: unknown;
  after?: unknown;
  /**
   * The domain events this action's write amounts to — a section move, a
   * status change — for the caller to publish once the run is over. Empty
   * when the write changed nothing.
   */
  events?: AutomationEvent[];
  /** What a "Send a webhook" action wants delivered; queued by the caller like `events`. */
  webhooks?: RuleWebhookRequest[];
  /** What a "Send an email" action wants sent; queued by the caller like `webhooks`. */
  emails?: RuleEmailRequest[];
}

/** What one rule's run hands back for the processor to send once it is over. */
interface RuleRun {
  ran: boolean;
  events: AutomationEvent[];
  webhooks: RuleWebhookRequest[];
  emails: RuleEmailRequest[];
}

/** A run's action steps, performed: what happened, and what is to be sent. */
interface StepsResult {
  /** Steps run, whether or not they succeeded. */
  attempted: number;
  failures: number;
  /** Steps not run because a cap was reached, each logged as such. */
  cut: number;
  /** Which cap, in words, when `cut` is above zero. */
  cutReason: string | null;
  events: AutomationEvent[];
  webhooks: RuleWebhookRequest[];
  emails: RuleEmailRequest[];
}

/**
 * What a step asked to have sent, as its log row keeps it — so a retried job
 * that finds the run already made can send the same things again.
 */
interface FollowUps {
  events?: AutomationEvent[];
  webhooks?: RuleWebhookRequest[];
  emails?: RuleEmailRequest[];
}

/** What `handle` reports back: counts for the log, events for the queue. */
export interface AutomationRunResult {
  executed: number;
  skipped: number;
  /** Webhook requests from "Send a webhook" actions, handed back for the same reason as `events`. */
  webhooks: RuleWebhookRequest[];
  /** Messages from "Send an email" actions, handed back for the same reason. */
  emails: RuleEmailRequest[];
  /**
   * Every event the rules' actions raised, in the order the actions ran.
   *
   * Handed back rather than enqueued here, deliberately. The runner has no
   * queue, so it never waits on Redis while holding a database connection
   * mid-execution, and a run that fails part-way has published nothing rather
   * than half a chain. The processor publishes these once `handle` returns;
   * each already carries the rule that caused it and a depth one greater,
   * which is what the guards at the top of `handle` read on the next hop.
   */
  events: AutomationEvent[];
}

/**
 * The task as conditions read it: its own columns plus its custom-field values,
 * loaded together so evaluation never reaches for the database mid-walk.
 */
type EvaluableTask = Task & {
  customFieldValues?: TaskCustomFieldValue[];
  facts?: TaskFacts;
  /**
   * The project's formula fields, worked out from the values above when the
   * task was loaded. A formula is never stored, so there is no row to read.
   */
  formulaValues?: ReadonlyMap<string, number | null>;
};

/**
 * What a rule's words can name: the task — or ticket — it acted on. A ticket
 * fills `task.name` with its title, so one set of variables serves both.
 */
interface TextSource {
  title: string;
  assigneeId: string | null;
  dueDate: Date | null;
  startDate?: Date | null;
  createdById?: string | null;
}

type TicketRow = Prisma.TicketGetPayload<object>;

/**
 * What a condition can ask about the task beyond its own columns — "has an
 * attachment", "has a comment", "is no longer blocked" — counted once with the
 * task rather than queried per condition mid-walk.
 */
interface TaskFacts {
  attachments: number;
  comments: number;
  /** Unfinished, unarchived tasks still blocking this one. */
  openBlockers: number;
}

/** The rule as the runner needs it. */
interface RunnableRule {
  id: string;
  name: string;
  workspaceId: string;
  projectId: string;
  createdById: string | null;
  /**
   * The running version's trigger configuration — what the event is matched
   * against, and the timezone a clock rule was set in, which dates in its text
   * use.
   */
  triggerConfig: Prisma.JsonValue;
  /** The running version's steps. */
  nodes: AutomationNode[];
  /** The version they came from, recorded on the run. */
  versionId: string;
}

/** A calendar date as the text variables print it: "Oct 20, 2026". */
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The task an event is about, twice over.
 *
 * `asFound` is the task as it was when the event happened: read once per
 * event, before the first rule runs, and never written to. Every rule's
 * conditions read it, so a rule is judged on the event it was given rather
 * than on what an earlier rule on the same event has since done. Without that,
 * four "when completed in this column, move to the next" rules walked a task
 * through every column in one execution, at depth zero, where no loop guard
 * could see it.
 *
 * `live` is the row the actions write, kept current by `updateTask` across
 * every rule on the event, so the second rule's write diffs against what the
 * first rule left rather than against the morning's state.
 */
interface TaskContext {
  asFound: EvaluableTask;
  live: EvaluableTask;
}

/** What one "Check with AI" answered in a run, or why it could not. */
interface AiCheckRecord {
  node: AutomationNode;
  holds: boolean;
  reason?: string;
  error?: string;
}

/**
 * Evaluates and runs automation rules.
 *
 * Runs on the worker, never inside the request that triggered it: a rule with
 * four actions must not add its latency to the click that caused it, and a
 * failing rule must not fail the user's own edit.
 */
@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  private readonly formulaValues: FormulaValuesService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly relay: RealtimeRelayPublisher,
    /** The AI steps. Absent, as in a test that builds the runner by hand, they fail with a reason. */
    private readonly ai?: AutomationAiService,
    /** Formula fields for conditions. Built on Prisma when a test builds the runner by hand. */
    formulaValues?: FormulaValuesService,
  ) {
    this.formulaValues = formulaValues ?? new FormulaValuesService(prisma);
  }

  /**
   * Finds the rules matching an event and runs each one.
   *
   * Returns how many executed, which is what the processor logs, and the
   * events their actions raised, which is what the processor publishes so the
   * next rule in a chain gets its turn.
   */
  async handle(event: AutomationEvent): Promise<AutomationRunResult> {
    /*
     * A ticket's event is for ticket rules, and a task's for task rules.
     *
     * Moving or re-prioritising a ticket on a board raises the task trigger
     * of the same name with a ticket as its subject; a task rule has no ticket
     * to act on, so those events are not for it, and a ticket rule never hears
     * a task's.
     */
    if ((event.entityType === 'TICKET') !== isTicketTrigger(event.trigger)) {
      return { executed: 0, skipped: 0, events: [], webhooks: [], emails: [] };
    }

    /*
     * Depth is checked before anything is read.
     *
     * Rules legitimately cascade, so a shallow limit would break real
     * workflows — but past a handful of hops it is a cycle, and the cost of
     * guessing wrong is a queue consuming itself.
     */
    if (event.depth >= MAX_AUTOMATION_DEPTH) {
      this.logger.warn(
        { correlationId: event.correlationId, depth: event.depth, trigger: event.trigger },
        'Automation chain stopped at the depth limit',
      );
      await this.recordSkipped(event, 'Depth limit reached — this looks like a loop.');
      return { executed: 0, skipped: 1, events: [], webhooks: [], emails: [] };
    }

    const rules = await this.runnableRules(event);

    const context = rules.length > 0 ? await this.loadTask(event) : null;

    let executed = 0;
    let skipped = 0;
    const events: AutomationEvent[] = [];
    const webhooks: RuleWebhookRequest[] = [];
    const emails: RuleEmailRequest[] = [];

    for (const rule of rules) {
      // A rule reacting to its own write is the commonest loop there is: one
      // that sets a status while listening for status changes. Blocking it
      // removes that whole class, and depth catches multi-rule cycles.
      if (BLOCK_SELF_RETRIGGER && event.causedByRuleId === rule.id) {
        skipped += 1;
        continue;
      }

      /*
       * A rule that only wants to answer people, not other rules.
       *
       * `depth` is above zero exactly when something else in this chain caused
       * the event, so it is the whole test. The depth limit already stops a
       * runaway; this is different — it is somebody saying "this one runs when
       * a person does it", which no amount of loop protection can express.
       */
      if (!rule.allowChaining && event.depth > 0) {
        skipped += 1;
        continue;
      }

      if (!this.triggerMatches(rule.triggerConfig, event)) {
        skipped += 1;
        continue;
      }

      const run = await this.runRule(rule, event, await this.inRuleProject(context, rule));
      if (run.ran) executed += 1;
      else skipped += 1;
      events.push(...run.events);
      webhooks.push(...run.webhooks);
      emails.push(...run.emails);
    }

    /*
     * A completed subtask may have completed its parent's checklist. Worked
     * out here, after this event's own rules, so the parent's event lands
     * behind them in the queue.
     */
    if (event.trigger === AutomationTrigger.TASK_COMPLETED) {
      const rollup = await this.subtaskRollup(event);
      if (rollup) events.push(rollup);

      // And the tasks it was holding up may be free to start.
      events.push(...(await this.unblockedDependents(event)));
    }

    return { executed, skipped, events, webhooks, emails };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The live rules this event is for, each with the version it runs.
   *
   * Matched on the *published* version's trigger and run from its steps — the
   * draft somebody is editing is never read here, so a half-finished edit to a
   * live rule cannot act on a task, and a trigger changed in the builder takes
   * effect when it is published rather than when it is typed.
   *
   * A run resuming after a Wait step finishes on the version it started on,
   * named in the event: republishing a rule while a run waits does not change
   * what that run does next. Such a run is found by its rule alone — its
   * trigger is the one it started with, which a later version may not share.
   */
  private async runnableRules(
    event: AutomationEvent,
  ): Promise<(RunnableRule & { allowChaining: boolean })[]> {
    const resuming = Boolean(event.resumeFromNodeId && event.ruleId);

    const rows = await this.prisma.automationRule.findMany({
      where: {
        projectId: { in: await this.ruleProjects(event) },
        status: AutomationRuleStatus.ACTIVE,
        ...(resuming ? {} : { publishedVersion: { is: { triggerType: event.trigger } } }),
        // A run somebody asked for by name, or one the clock found due, is
        // for that rule alone — not every rule that shares its trigger.
        ...(event.ruleId ? { id: event.ruleId } : {}),
      },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        projectId: true,
        createdById: true,
        allowChaining: true,
        publishedVersionId: true,
      },
      // Oldest first, ids as the tie-break: two rules writing the same column
      // on one event must resolve the same way every time, not however the
      // table happened to be laid out.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const wanted = new Map(
      rows.map((rule) => [rule.id, (resuming && event.resumeVersionId) || rule.publishedVersionId]),
    );
    const versions = await this.prisma.automationRuleVersion.findMany({
      where: { id: { in: [...wanted.values()].filter((id): id is string => Boolean(id)) } },
      select: { id: true, ruleId: true, triggerConfig: true, nodes: true },
    });
    const byId = new Map(versions.map((version) => [version.id, version]));

    return rows.flatMap((rule) => {
      const version = byId.get(wanted.get(rule.id) ?? '');
      const nodes = version && version.ruleId === rule.id ? readSnapshot(version.nodes) : null;

      // Live with nothing published is not a state publishing can leave, so a
      // rule here was switched on some other way. It runs nothing rather than
      // its draft, and says so where somebody looking will see it.
      if (!version || !nodes) {
        this.logger.warn({ ruleId: rule.id }, 'Active rule has no published version to run');
        return [];
      }

      return [
        {
          id: rule.id,
          name: rule.name,
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
          createdById: rule.createdById,
          allowChaining: rule.allowChaining,
          triggerConfig: version.triggerConfig,
          nodes,
          versionId: version.id,
        },
      ];
    });
  }

  /**
   * Whose rules hear an event — multi-homing.
   *
   * A change to the task itself (its status, assignee, fields, a comment) is
   * news to every project it is in, so each of their rules may answer. Where
   * it sits is not: "added to this project" and "moved to a section" belong to
   * the one project where that happened, and a run asked for by name is for
   * its own project alone.
   */
  private async ruleProjects(event: AutomationEvent): Promise<string[]> {
    if (
      event.ruleId ||
      event.trigger === AutomationTrigger.TASK_CREATED ||
      event.trigger === AutomationTrigger.TASK_MOVED_TO_SECTION
    ) {
      return [event.projectId];
    }

    const taskId =
      event.entityType === 'TASK'
        ? event.entityId
        : event.entityType === 'COMMENT' && typeof event.after?.['taskId'] === 'string'
          ? event.after['taskId']
          : null;
    if (!taskId) return [event.projectId];

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: event.workspaceId },
      select: { projectId: true, projectLinks: { select: { projectId: true } } },
    });
    if (!task) return [event.projectId];

    return [
      ...new Set([
        event.projectId,
        ...(task.projectId ? [task.projectId] : []),
        ...task.projectLinks.map((link) => link.projectId),
      ]),
    ];
  }

  /**
   * The task as a rule in one of its other projects sees it: in that project's
   * section, so "section is Review" means that board's Review. Its home
   * project id stays, which is how an action tells a link from the home.
   */
  private async inRuleProject(
    context: TaskContext | null,
    rule: { projectId: string },
  ): Promise<TaskContext | null> {
    if (!context || !context.live.projectId || context.live.projectId === rule.projectId) {
      return context;
    }
    const link = await this.prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId: context.live.id, projectId: rule.projectId } },
      select: { sectionId: true },
    });
    if (!link) return context;
    return {
      live: { ...context.live, sectionId: link.sectionId },
      asFound: { ...context.asFound, sectionId: link.sectionId },
    };
  }

  /**
   * The other half of "task or all subtasks completed".
   *
   * A person finishing the last item on a checklist has finished the
   * checklist, and the trigger's label promises to fire for that. Nothing in
   * the request path knows the siblings, so the engine works it out from the
   * event it already has: a completed subtask whose siblings are all complete
   * raises the same event again for its parent — on the same thread, at the
   * same depth, because a person finishing the last subtask is still a person
   * doing it — and the processor publishes it like any other.
   *
   * Not when the parent is already complete on its own account: its own
   * completion raised this trigger already, and raising it twice would run
   * every rule on it twice.
   */
  private async subtaskRollup(event: AutomationEvent): Promise<AutomationEvent | null> {
    const subtask = await this.prisma.task.findFirst({
      where: { id: event.entityId, workspaceId: event.workspaceId },
      select: { parentTaskId: true },
    });

    if (!subtask?.parentTaskId) return null;

    const parent = await this.prisma.task.findFirst({
      where: { id: subtask.parentTaskId, archivedAt: null },
      select: {
        id: true,
        completedAt: true,
        subtasks: { where: { archivedAt: null }, select: { completedAt: true } },
      },
    });

    if (!parent || parent.completedAt !== null) return null;
    if (parent.subtasks.some((row) => row.completedAt === null)) return null;

    return {
      ...event,
      // Its own event, not the subtask's: webhooks key deliveries on the id.
      // Derived from the subtask's, so a retried run raises the same one.
      eventId: derivedEventId(event.eventId, `rollup:${parent.id}`),
      entityType: 'TASK',
      entityId: parent.id,
      before: { allSubtasksCompleted: false },
      after: { allSubtasksCompleted: true, subtaskCount: parent.subtasks.length },
    };
  }

  /**
   * "Task is no longer blocked", for every task this completion freed.
   *
   * Worked out here for the same reason the checklist roll-up is: nothing in
   * the request path looks across dependencies. A dependent is free when no
   * unfinished task blocks it any more — this one was merely the last — and it
   * hears about it in its own project, at the depth of the completion that
   * freed it, because a person finishing the blocker is still a person doing it.
   *
   * Not for the roll-up event raised when a parent's last subtask completes:
   * the parent itself is still open, and has blocked nothing free yet.
   */
  private async unblockedDependents(event: AutomationEvent): Promise<AutomationEvent[]> {
    if (event.entityType !== 'TASK') return [];

    const blocker = await this.prisma.task.findFirst({
      where: { id: event.entityId, workspaceId: event.workspaceId },
      select: { completedAt: true },
    });
    if (!blocker?.completedAt) return [];

    const links = await this.prisma.taskDependency.findMany({
      where: { blockingTaskId: event.entityId },
      select: {
        blockedTask: {
          select: {
            id: true,
            projectId: true,
            completedAt: true,
            archivedAt: true,
            blockedBy: {
              where: { blockingTask: { completedAt: null, archivedAt: null } },
              select: { id: true },
            },
          },
        },
      },
    });

    return links
      .map((link) => link.blockedTask)
      .filter(
        (task): task is typeof task & { projectId: string } =>
          task.projectId !== null &&
          task.completedAt === null &&
          task.archivedAt === null &&
          task.blockedBy.length === 0,
      )
      .map((task) => ({
        ...event,
        eventId: derivedEventId(event.eventId, `unblocked:${task.id}`),
        projectId: task.projectId,
        trigger: AutomationTrigger.TASK_NO_LONGER_BLOCKED,
        entityType: 'TASK' as const,
        entityId: task.id,
        before: { blocked: true },
        after: { blocked: false, blockerId: event.entityId },
        ruleId: null,
      }));
  }

  /**
   * Trigger-level scoping, before conditions are considered.
   *
   * `TASK_MOVED_TO_SECTION` with a section in its config only fires for that
   * section, and `CUSTOM_FIELD_CHANGED` with a field only fires for that field —
   * checked here rather than as conditions so the common case costs nothing.
   * Either key absent means unscoped, which is what every rule saved before the
   * narrowing existed stored.
   */
  private triggerMatches(config: Prisma.JsonValue, event: AutomationEvent): boolean {
    const scope = (config ?? {}) as {
      form?: string;
      sectionId?: string;
      sectionIds?: unknown;
      fieldId?: string;
    };

    /*
     * The stored form is read before the section, always. A rule saved as
     * "section is not Done" that fell through to the equality test would fire
     * on exactly the moves it was written to exclude.
     */
    if (event.trigger === AutomationTrigger.TASK_MOVED_TO_SECTION) {
      const landed = event.after?.['sectionId'];

      switch (scope.form) {
        case TRIGGER_CONFIG_FORM.SECTION_CHANGED:
          return true;
        case TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_NOT:
          return !scope.sectionId || landed !== scope.sectionId;
        case TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_ANY_OF:
          return Array.isArray(scope.sectionIds) && scope.sectionIds.includes(landed);
        default:
          // "Section is…", and every rule saved before forms existed.
          return !scope.sectionId || landed === scope.sectionId;
      }
    }

    // "Ticket status changes to…": left blank, any change.
    if (event.trigger === AutomationTrigger.TICKET_STATUS_CHANGED) {
      const wanted = (config as { status?: unknown } | null)?.status;
      return typeof wanted !== 'string' || wanted === '' || event.after?.['status'] === wanted;
    }

    // Matched on the id, never the name: the name is somebody's to rename.
    if (scope.fieldId && event.trigger === 'CUSTOM_FIELD_CHANGED') {
      return event.after?.['fieldId'] === scope.fieldId;
    }

    return true;
  }

  /**
   * One read of the task for every rule on the event. See `TaskContext`.
   *
   * Copied one level down: `updateTask` assigns onto the live row and
   * `SET_CUSTOM_FIELD` replaces its values array, and neither may reach the
   * copy the conditions read. Not `structuredClone`, which would strip the
   * prototype off the Decimals a number field's value carries.
   */
  private async loadTask(event: AutomationEvent): Promise<TaskContext | null> {
    // A comment event names the comment; the task it was left on rides in
    // `after`. Comments on tickets carry no task, so their rules are skipped.
    const taskId =
      event.entityType === 'COMMENT'
        ? typeof event.after?.['taskId'] === 'string'
          ? event.after['taskId']
          : null
        : event.entityId;

    if (!taskId) return null;

    const row = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: event.workspaceId },
      include: { customFieldValues: true },
    });

    if (!row) return null;

    // Counted the way the task row counts them: live comments, finished
    // uploads, and blockers that are neither done nor archived.
    const [attachments, comments, openBlockers] = await Promise.all([
      this.prisma.attachment.count({ where: { taskId, status: 'READY' } }),
      this.prisma.comment.count({ where: { taskId, deletedAt: null } }),
      this.prisma.taskDependency.count({
        where: { blockedTaskId: taskId, blockingTask: { completedAt: null, archivedAt: null } },
      }),
    ]);
    const facts: TaskFacts = { attachments, comments, openBlockers };
    const formulaValues = await this.formulasFor(event.projectId, row.id, row.customFieldValues);
    const live: EvaluableTask = { ...row, facts, formulaValues };

    return {
      live,
      asFound: {
        ...row,
        customFieldValues: row.customFieldValues.map((value) => ({ ...value })),
        facts: { ...facts },
        formulaValues,
      },
    };
  }

  /**
   * The formula fields on the event's project, worked out for this task.
   *
   * Formulas are calculated when read and never stored, so a condition on one
   * had nothing to compare. "Days to complete is under 1" read empty and never
   * held. They are worked out here once per event, from the values loaded with
   * the task and the same evaluator the task list uses, so a rule sees the
   * number the board shows. A project with no formula fields costs one indexed
   * query and nothing more.
   */
  private async formulasFor(
    projectId: string | undefined,
    taskId: string,
    rows: readonly TaskCustomFieldValue[],
  ): Promise<ReadonlyMap<string, number | null> | undefined> {
    if (!projectId) return undefined;
    const plan = await this.formulaValues.plan(projectId);
    if (!plan) return undefined;

    const computed = this.formulaValues.compute(plan, [
      {
        taskId,
        values: rows.map((row) => ({
          customFieldId: row.customFieldId,
          number: row.numberValue === null ? null : Number(row.numberValue),
          date: row.dateValue?.toISOString() ?? null,
        })),
      },
    ]);
    return new Map(
      (computed.get(taskId) ?? []).map((value) => [value.customFieldId, value.number]),
    );
  }

  private async runRule(
    rule: RunnableRule,
    event: AutomationEvent,
    context: TaskContext | null,
  ): Promise<RuleRun> {
    const started = Date.now();

    const begun = await this.begin(rule, event);
    if ('replay' in begun) return begun.replay;
    const execution = begun.execution;

    // A scheduled rule with no tasks in scope: it can only make new ones.
    if (!context && event.entityType === 'PROJECT') {
      return this.runTaskless(rule, event, execution.id, started);
    }

    // A ticket rule acts on the ticket. See `runTicketRule`.
    if (event.entityType === 'TICKET') {
      return this.runTicketRule(rule, event, execution.id, started);
    }

    if (!context) {
      await this.finish(execution.id, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason: 'The task no longer exists.',
      });
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    // Judged on the task as the event found it, run against the live row:
    // see `TaskContext`.
    const { asFound, live: task } = context;

    // Conditions are all-or-nothing: a rule whose conditions do not hold has
    // not failed, it simply does not apply. Recorded as SKIPPED with a reason
    // so the history distinguishes "did not match" from "went wrong".
    const checks: AiCheckRecord[] = [];
    const plan = await this.plan(
      rule.nodes,
      (node) => this.holdsAsked(node, asFound, event, rule, checks),
      event.resumeFromNodeId,
    );
    await this.recordAiChecks(execution.id, checks);

    if (plan.skippedBy) {
      const stopping = checks.find((check) => check.node.id === plan.stoppedBy?.id);

      // An AI check that could not be asked has not answered no: the rule went
      // wrong rather than not applying, and the history should say which.
      if (stopping?.error) {
        await this.finish(execution.id, AutomationExecutionStatus.FAILED, started, {
          error: `The AI check could not run: ${stopping.error}`,
        });
        await this.bumpRule(rule.id, AutomationExecutionStatus.FAILED, true);
        return { ran: false, events: [], webhooks: [], emails: [] };
      }

      await this.finish(execution.id, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason:
          plan.skippedBy === 'the rule changed while it was waiting'
            ? 'The rule changed while this run was waiting.'
            : stopping
              ? `AI answered no: ${stopping.reason || 'no reason given'}`.slice(0, 500)
              : `Condition not met: ${plan.skippedBy}.`,
      });
      await this.bumpRule(rule.id, AutomationExecutionStatus.SKIPPED);
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    // One failing action does not abandon the rest: a rule that assigns
    // someone and adds a comment should still comment if the assignment
    // fails, and the log says which did what.
    const steps = await this.perform(execution.id, event, plan.actions, (node) =>
      this.runAction(node, task, rule, event, new Date(started)),
    );
    const { failures, events, webhooks, emails } = steps;

    if (await this.stoppedByChain(rule, execution.id, steps, started)) {
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    const status = runStatus(steps);

    await this.scheduleDelays(rule, event, plan.delays, execution.id, started);
    await this.finish(execution.id, status, started, cutNote(steps));
    await this.bumpRule(rule.id, status, failures > 0 || steps.cut > 0);

    /*
     * The activity feed has to say a rule did this.
     *
     * Otherwise a task changes assignee with nothing in its history explaining
     * why, and the only honest reading is that a colleague did it. Naming the
     * rule is what makes an automated change accountable rather than spooky.
     *
     * Written after the actions rather than per action: the feed is a summary
     * for people, and the per-action detail already lives in the execution log
     * for anyone debugging.
     */
    if (steps.attempted > failures) {
      await this.prisma.activityLog.create({
        data: {
          workspaceId: rule.workspaceId,
          // Attributed to whoever caused the trigger, because the change is a
          // consequence of what they did. The summary says a rule performed it.
          actorId: event.actorId ?? null,
          action: ActivityAction.UPDATED,
          entity: ActivityEntity.TASK,
          entityId: task.id,
          summary: `Automation "${rule.name}" updated "${task.title}"`,
          metadata: {
            ruleId: rule.id,
            executionId: execution.id,
            actions: steps.attempted,
            failures,
          },
        },
      });

      /*
       * Open tabs get told, or the rule's work is invisible until a reload.
       *
       * The user's own action refetched the list a beat *before* this ran, so
       * without a broadcast the row shows the pre-rule state while the task
       * dialog — fetching fresh — shows the post-rule one, and the two halves
       * of the screen disagree.
       *
       * Deliberately no correlation id: the chain inherits the id of the
       * user's original mutation, and echoing it would make exactly the tab
       * that caused the trigger — the one looking at the stale row — skip the
       * refetch as its "own" change. A rule's write is nobody's own change.
       *
       * Sent to everyone who may see the project rather than to its room: a
       * task panel open from My Tasks, the inbox or search is in no project
       * room, and kept showing the fields and checklists from before the rule.
       */
      // Both projects when the rule moved the task out of this one: the tab on
      // the old board has to drop the row, and the tab on the new one has to
      // gain it.
      const projectIds = new Set([event.projectId, task.projectId ?? event.projectId]);

      for (const projectId of projectIds) {
        await this.relay.toProjectAudience(
          rule.workspaceId,
          projectId,
          ServerEvent.WORK_ITEM_UPDATED,
          {
            workspaceId: rule.workspaceId,
            projectId,
            workItemId: task.id,
            workItemType: WorkItemType.TASK,
            occurredAt: new Date().toISOString(),
            source: 'automation',
          },
        );
      }
    }

    return { ran: true, events, webhooks, emails };
  }

  /**
   * A rule run with no task at all — a schedule whose scope is "no tasks".
   *
   * Only "Create a task" and "Draft an update with AI…" have anything to act
   * on — a new task, and the project; the validator refuses the rest, and
   * refuses conditions, so a rule reaching here holds what it can run.
   * Anything else is logged as a failure rather than skipped quietly.
   */
  private async runTaskless(
    rule: RunnableRule,
    event: AutomationEvent,
    executionId: string,
    started: number,
  ): Promise<RuleRun> {
    const actions = rule.nodes.filter((node) => node.nodeType === AutomationNodeType.ACTION);

    const steps = await this.perform(executionId, event, actions, async (node) => {
      const config = (node.configuration ?? {}) as Record<string, unknown>;

      return node.subtype === AutomationAction.CREATE_TASK
        ? this.createTask(config, null, rule, event, new Date(started))
        : node.subtype === AutomationAction.AI_DRAFT_UPDATE
          ? this.draftStatusUpdate(rule, config, new Date(started))
          : {
              succeeded: false,
              message: 'This step needs a task, and this run had none in scope.',
            };
    });
    const { failures, events } = steps;

    if (await this.stoppedByChain(rule, executionId, steps, started)) {
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    const status = runStatus(steps);

    await this.finish(executionId, status, started, cutNote(steps));
    await this.bumpRule(rule.id, status, failures > 0 || steps.cut > 0);

    if (steps.attempted > failures) {
      // Beyond the project's room for the same reason as a task run: the new
      // task may be somebody's, and their My Tasks is in no project room.
      await this.relay.toProjectAudience(
        rule.workspaceId,
        rule.projectId,
        ServerEvent.WORK_ITEM_UPDATED,
        {
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
          occurredAt: new Date().toISOString(),
          source: 'automation',
        },
      );
    }

    return { ran: true, events, webhooks: [], emails: [] };
  }

  /* ------------------------------------------------------------------------ */
  /* Runs, once each                                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * The run this rule makes of this event — or, when it has already made it,
   * what that run asked to have sent.
   *
   * A queue job that throws is retried from the beginning, and every rule
   * before the one that threw has already acted. Keyed on the rule and the
   * event (`runKey`), the second attempt finds those runs and leaves their
   * work alone; it hands back the events, webhooks and e-mails their steps
   * recorded, so the chain they started is not lost with the attempt that
   * raised it. The queue drops a repeated event too, but only while it still
   * holds the first one — this is the answer that does not expire.
   *
   * A run found still RUNNING stopped part-way. Its steps are not attempted
   * again: which of them took effect is not knowable from here, and a comment
   * posted twice or a second set of subtasks is the harm this exists to
   * prevent. It is closed as FAILED with that said, and what its finished
   * steps raised still goes out.
   */
  private async begin(
    rule: RunnableRule,
    event: AutomationEvent,
  ): Promise<{ execution: { id: string } } | { replay: RuleRun }> {
    const key = runKey(event);
    const where = { ruleId_idempotencyKey: { ruleId: rule.id, idempotencyKey: key } };

    const prior = await this.prisma.automationExecution.findUnique({
      where,
      select: { id: true, status: true, startedAt: true },
    });
    if (prior) return { replay: await this.replay(prior) };

    try {
      const execution = await this.prisma.automationExecution.create({
        data: {
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.RUNNING,
          triggerType: event.trigger,
          entityType: event.entityType,
          entityId: event.entityId,
          actorId: event.actorId ?? null,
          correlationId: event.correlationId,
          chainId: chainOf(event),
          idempotencyKey: key,
          depth: event.depth,
          ruleVersionId: rule.versionId,
        },
        select: { id: true },
      });

      return { execution };
    } catch (error) {
      // Another attempt got there between the read and the write.
      if (!isUniqueViolation(error)) throw error;

      const rival = await this.prisma.automationExecution.findUniqueOrThrow({
        where,
        select: { id: true, status: true, startedAt: true },
      });
      return { replay: await this.replay(rival) };
    }
  }

  /** What an earlier attempt's run raised, to be sent again. See `begin`. */
  private async replay(prior: { id: string; status: string; startedAt: Date }): Promise<RuleRun> {
    if (prior.status === AutomationExecutionStatus.RUNNING) {
      await this.finish(prior.id, AutomationExecutionStatus.FAILED, prior.startedAt.getTime(), {
        error:
          'This run stopped part-way and was not repeated, so none of its steps happens twice.',
      });
    }

    const logs = await this.prisma.automationExecutionLog.findMany({
      where: { executionId: prior.id, followUps: { not: Prisma.DbNull } },
      orderBy: { createdAt: 'asc' },
      select: { followUps: true },
    });

    const replayed: RuleRun = { ran: false, events: [], webhooks: [], emails: [] };
    for (const log of logs) {
      const sent = (log.followUps ?? {}) as FollowUps;
      replayed.events.push(...(sent.events ?? []));
      replayed.webhooks.push(...(sent.webhooks ?? []));
      replayed.emails.push(...(sent.emails ?? []));
    }

    return replayed;
  }

  /**
   * Runs a plan's action steps, as many as the caps allow, logging each.
   *
   * Two caps, and whichever is lower applies: `MAX_ACTIONS_PER_EXECUTION` for
   * this run, and what is left of `MAX_ACTIONS_PER_CHAIN` once every other run
   * descended from the same event is counted. The steps past it are not
   * dropped quietly — each gets a log row saying it did not run and why, and
   * the run is not reported as COMPLETED. A rule that does less than it says
   * while claiming success is the failure this engine refuses everywhere else.
   *
   * Each step's log row keeps what the step asked to have sent, which is what
   * a retried job reads back — see `begin`.
   */
  private async perform(
    executionId: string,
    event: AutomationEvent,
    steps: readonly AutomationNode[],
    run: (node: AutomationNode) => Promise<ActionOutcome>,
  ): Promise<StepsResult> {
    const result: StepsResult = {
      attempted: 0,
      failures: 0,
      cut: 0,
      cutReason: null,
      events: [],
      webhooks: [],
      emails: [],
    };
    if (steps.length === 0) return result;

    const { limit, reason } = await this.allowance(event, executionId);

    for (const node of steps.slice(0, limit)) {
      const outcome = await run(node).catch((error: unknown): ActionOutcome => ({
        succeeded: false,
        message: error instanceof Error ? error.message : 'Action failed.',
      }));

      result.attempted += 1;
      if (!outcome.succeeded) result.failures += 1;
      result.events.push(...(outcome.events ?? []));
      result.webhooks.push(...(outcome.webhooks ?? []));
      result.emails.push(...(outcome.emails ?? []));

      const followUps: FollowUps = {
        ...(outcome.events?.length ? { events: outcome.events } : {}),
        ...(outcome.webhooks?.length ? { webhooks: outcome.webhooks } : {}),
        ...(outcome.emails?.length ? { emails: outcome.emails } : {}),
      };

      await this.prisma.automationExecutionLog.create({
        data: {
          executionId,
          nodeId: node.id,
          nodeType: node.nodeType,
          subtype: node.subtype,
          succeeded: outcome.succeeded,
          message: outcome.message?.slice(0, 500) ?? null,
          beforeValue: (outcome.before ?? null) as Prisma.InputJsonValue,
          afterValue: (outcome.after ?? null) as Prisma.InputJsonValue,
          ...(Object.keys(followUps).length > 0
            ? { followUps: followUps as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
    }

    const cut = steps.slice(limit);
    if (cut.length > 0) {
      result.cut = cut.length;
      result.cutReason = reason;

      await this.prisma.automationExecutionLog.createMany({
        data: cut.map((node) => ({
          executionId,
          nodeId: node.id,
          nodeType: node.nodeType,
          subtype: node.subtype,
          succeeded: false,
          message: `Not run: ${reason}.`,
        })),
      });
    }

    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: { actionsRun: result.attempted },
    });

    return result;
  }

  /**
   * How many actions this run may perform, and the cap that says so.
   *
   * The chain's total is summed from the runs already recorded under its id,
   * this one aside. A run in progress beside this one has not recorded its
   * count yet, so the sum can be short by one run's worth — a backstop against
   * a runaway, which this is, does not need to be exact to the action.
   */
  private async allowance(
    event: AutomationEvent,
    executionId: string,
  ): Promise<{ limit: number; reason: string }> {
    const spent = await this.prisma.automationExecution.aggregate({
      where: { chainId: chainOf(event), id: { not: executionId } },
      _sum: { actionsRun: true },
    });
    const left = Math.max(0, MAX_ACTIONS_PER_CHAIN - (spent._sum.actionsRun ?? 0));

    return left < MAX_ACTIONS_PER_EXECUTION
      ? {
          limit: left,
          reason: `the rules this change set off had made ${MAX_ACTIONS_PER_CHAIN} changes between them, which is as many as one change may cause`,
        }
      : {
          limit: MAX_ACTIONS_PER_EXECUTION,
          reason: `a rule does at most ${MAX_ACTIONS_PER_EXECUTION} actions in one run`,
        };
  }

  /**
   * A run whose every step the chain cap refused: closed as SKIPPED, with the
   * reason, rather than as a run that did nothing successfully.
   */
  private async stoppedByChain(
    rule: RunnableRule,
    executionId: string,
    steps: StepsResult,
    started: number,
  ): Promise<boolean> {
    if (steps.attempted > 0 || steps.cut === 0) return false;

    await this.finish(executionId, AutomationExecutionStatus.SKIPPED, started, {
      skippedReason: `Stopped: ${steps.cutReason ?? 'a limit was reached'}. This looks like a loop.`,
    });
    await this.bumpRule(rule.id, AutomationExecutionStatus.SKIPPED);
    this.logger.warn(
      { ruleId: rule.id, executionId, cut: steps.cut },
      'Automation chain stopped at the action limit',
    );
    return true;
  }

  /**
   * Which actions this event should run, and what stopped it if none.
   *
   * Two shapes of rule exist and both have to keep working.
   *
   * A rule authored before the canvas has no parentage at all — every node's
   * `parentNodeId` is null — and its meaning is "every condition must hold,
   * then every action runs". Walking that as a tree would treat each node as
   * its own root and change what nine live rules do, so it keeps the flat
   * evaluation it has always had.
   *
   * A rule built on the canvas has parentage, and its meaning is the path: a
   * condition that does not hold stops everything under it, and a branch sends
   * execution down one arm. The presence of a single parent link is what tells
   * the two apart, because that is the only thing that actually differs.
   *
   * The conditions hanging straight off the trigger are that rule's *rows*, and
   * they are the one place a plain walk would be wrong. Rows are alternatives —
   * "check if… otherwise if… otherwise" — so visiting every one of them would
   * run every branch that happened to match rather than the first, which is a
   * rule doing two contradictory things to the same task. First match wins, and
   * the rest of the tree is walked exactly as before.
   *
   * `task` is the task as the event found it, never the live row: a rule is
   * judged on the event it was given, not on what a sibling rule on the same
   * event has since written. See `TaskContext`.
   */
  private async plan(
    nodes: AutomationNode[],
    /*
     * Asynchronous because "Check with AI" asks a model. Only the conditions
     * the walk reaches are asked — a row below the one that matched, or an
     * arm not taken, costs nothing.
     */
    holds: (node: AutomationNode) => boolean | Promise<boolean>,
    /** A Wait step to pick up after, when the clock resumes a run. */
    resumeFrom?: string | null,
  ): Promise<{
    actions: AutomationNode[];
    delays: AutomationNode[];
    skippedBy: string | null;
    /** The condition that stopped the run, when one did. */
    stoppedBy?: AutomationNode;
  }> {
    const isTree = nodes.some((node) => node.parentNodeId !== null);

    if (!isTree) {
      // Every condition, again on a resumed run: the task may have changed
      // while the run waited.
      let unmet: AutomationNode | undefined;
      for (const node of nodes.filter((row) => row.nodeType === AutomationNodeType.CONDITION)) {
        if (!(await holds(node))) {
          unmet = node;
          break;
        }
      }

      if (unmet) return { actions: [], delays: [], skippedBy: unmet.subtype, stoppedBy: unmet };

      // In order, up to the next Wait step — or from just after the one a
      // resumed run waited at.
      const steps = nodes
        .filter(
          (node) =>
            node.nodeType === AutomationNodeType.ACTION ||
            node.nodeType === AutomationNodeType.DELAY,
        )
        .sort((a, b) => a.position - b.position);
      const from = resumeFrom ? steps.findIndex((node) => node.id === resumeFrom) + 1 : 0;
      if (resumeFrom && from === 0) {
        return { actions: [], delays: [], skippedBy: 'the rule changed while it was waiting' };
      }
      const actions: AutomationNode[] = [];
      const delays: AutomationNode[] = [];
      for (const node of steps.slice(from)) {
        if (node.nodeType === AutomationNodeType.DELAY) {
          delays.push(node);
          break;
        }
        actions.push(node);
      }
      return { actions, delays, skippedBy: null };
    }

    const trigger = nodes.find((node) => node.nodeType === AutomationNodeType.TRIGGER);
    if (!trigger) return { actions: [], delays: [], skippedBy: 'no trigger' };
    // A run resumed after a Wait step the rule no longer has: it was edited
    // while the run waited, and what followed that step is gone with it.
    if (resumeFrom && !nodes.some((node) => node.id === resumeFrom)) {
      return { actions: [], delays: [], skippedBy: 'the rule changed while it was waiting' };
    }

    const actions: AutomationNode[] = [];
    const delays: AutomationNode[] = [];
    let skippedBy: string | null = null;
    let stoppedBy: AutomationNode | undefined;

    const childrenOf = (parentId: string, arm: string | null) =>
      nodes
        .filter((node) => node.parentNodeId === parentId)
        .filter((node) => (arm === null ? true : node.branchKey === arm))
        .sort((a, b) => a.position - b.position);

    /*
     * Depth-limited on purpose. A cycle is refused at validation, but the
     * runner reads rows that may have been written by an older client, and a
     * loop here would hang the worker rather than produce a wrong answer.
     *
     * `rows` says that the conditions among these children are alternatives to
     * one another rather than steps on one path. Only the trigger's children
     * are, which is why it is a parameter rather than the rule everywhere: a
     * condition further down still governs what follows it, and a rule that
     * checks two things in sequence must go on doing both.
     */
    const walk = async (
      nodeId: string,
      arm: string | null,
      depth: number,
      rows = false,
    ): Promise<void> => {
      if (depth > 50) return;

      // Which is to say: a row has already claimed this event. Ordering is by
      // `position`, so "first" is the row nearest the top of the canvas.
      let matched = false;

      for (const node of childrenOf(nodeId, arm)) {
        if (node.nodeType === AutomationNodeType.CONDITION) {
          if (rows && matched) continue;

          // A condition governs what follows it, not the whole rule. Its
          // siblings on another path are unaffected.
          if (!(await holds(node))) {
            skippedBy ??= node.subtype;
            stoppedBy ??= node;
            continue;
          }

          if (rows) matched = true;

          await walk(node.id, null, depth + 1);
          continue;
        }

        if (node.nodeType === AutomationNodeType.BRANCH) {
          const branchHolds = await holds(node);

          await walk(node.id, branchHolds ? BranchKey.MATCH : BranchKey.ELSE, depth + 1);
          continue;
        }

        if (node.nodeType === AutomationNodeType.ACTION) {
          actions.push(node);
          await walk(node.id, null, depth + 1);
        }

        // A Wait step: what follows it runs later, when the clock resumes the
        // run from here — not now.
        if (node.nodeType === AutomationNodeType.DELAY) delays.push(node);
      }
    };

    if (resumeFrom) await walk(resumeFrom, null, 0);
    else await walk(trigger.id, null, 0, true);

    // "Nothing ran" is only a skip when something stopped it. A rule whose
    // branch legitimately led nowhere has run and done nothing — and one that
    // reached a Wait step has made progress.
    const stopped = actions.length === 0 && delays.length === 0;
    return {
      actions,
      delays,
      skippedBy: stopped ? skippedBy : null,
      ...(stopped && stoppedBy ? { stoppedBy } : {}),
    };
  }

  /**
   * Whether a condition holds, asking the model when it is "Check with AI".
   *
   * Every other condition is `conditionHolds`, judged on the task as the event
   * found it. An AI check reads the task as it is now — the model is handed a
   * fresh read — and what it answered goes into `checks` for the log.
   */
  private async holdsAsked(
    node: AutomationNode,
    task: EvaluableTask,
    event: AutomationEvent,
    rule: RunnableRule,
    checks: AiCheckRecord[],
  ): Promise<boolean> {
    const config = (node.configuration ?? {}) as Record<string, unknown>;
    if (config['field'] !== AI_CHECK_FIELD) return this.conditionHolds(node, task, event);

    try {
      if (!this.ai?.available) throw new AiUnavailableError();
      const answer = await this.ai.check(task.id, rule, String(config['question'] ?? ''));
      checks.push({ node, holds: answer.holds, reason: answer.reason });
      return answer.holds;
    } catch (error) {
      checks.push({
        node,
        holds: false,
        error: error instanceof Error ? error.message : 'The AI check failed.',
      });
      return false;
    }
  }

  /** One log row per AI check: what it answered and why, or why it could not. */
  private async recordAiChecks(executionId: string, checks: AiCheckRecord[]): Promise<void> {
    for (const check of checks) {
      await this.prisma.automationExecutionLog.create({
        data: {
          executionId,
          nodeId: check.node.id,
          nodeType: check.node.nodeType,
          subtype: check.node.subtype,
          succeeded: !check.error,
          message: (check.error
            ? `The AI check could not run: ${check.error}`
            : `AI answered ${check.holds ? 'yes' : 'no'}: ${check.reason || 'no reason given'}`
          ).slice(0, 500),
          beforeValue: null as unknown as Prisma.InputJsonValue,
          afterValue: (check.error ? null : { holds: check.holds }) as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * Whether a condition step holds: one comparison, or a group of them.
   *
   * A group is `ALL` or `ANY` of its entries, each judged the same way and a
   * nested group by recursion — `evaluateCondition` in the contracts is the one
   * reading of that shape, shared with the builder and the validator.
   *
   * The fallback row holds, always. "If all other conditions are not met" is
   * what makes it the last row rather than a comparison of its own — it has no
   * field and no operator, so every branch below would read it as an unknown
   * operator and return false, and the one row somebody added to catch
   * everything would catch nothing.
   */
  private conditionHolds(
    node: AutomationNode,
    task: EvaluableTask,
    event: AutomationEvent,
  ): boolean {
    return evaluateCondition(node.configuration, (comparison) =>
      this.comparisonHolds(comparison, node.subtype, task, event),
    );
  }

  /** One comparison. `subtype` is the field a rule from before the canvas named. */
  private comparisonHolds(
    configuration: Record<string, unknown>,
    subtype: string,
    task: EvaluableTask,
    event: AutomationEvent,
  ): boolean {
    const config = configuration as {
      field?: string;
      operator?: string;
      value?: unknown;
    };

    const actual = this.readField(config.field ?? subtype, task, event);
    const expected = config.value;

    /*
     * The comparisons the engine makes itself, before any translation.
     *
     * "Is checked" has no right-hand side, "between" has two, and the date
     * checks compare against the clock — none of which the filter vocabulary
     * below can say. They were offered by every checkbox, number and date row
     * and had no case anywhere, so a rule using one published cleanly and was
     * false on every event. `DIRECT_CONDITION_OPERATORS` is what now tells the
     * catalogue and the validator that these run.
     */
    if (isDirectOperator(config.operator)) {
      return directComparison(config.operator, actual, expected);
    }

    /*
     * The comparison this operator names, whichever vocabulary named it.
     *
     * The builder writes the reading names — `IS`, `IS_ONE_OF`, `IS_BEFORE` —
     * and rules written before those existed hold the query engine's names.
     * Both spellings mean one comparison, so both are translated to it here
     * rather than duplicating every case below. An operator with no comparison
     * still falls to `default` and blocks the rule.
     */
    const comparison = toFilterOperator(config.operator);

    /*
     * A many-valued field compares by membership.
     *
     * A multi-select or people field holds a set, and "Tags is set to Urgent"
     * is asked — and meant — as "is Urgent among them". Read as equality it
     * could never hold once a second value was ticked, so the condition that
     * looked answered on the card was false on every event. `readField`
     * unwraps a one-entry set to its value, so the scalar cases below still
     * serve the common shape; these arms serve the rest of it.
     */
    if (Array.isArray(actual)) {
      const held = actual.map(String);

      switch (comparison) {
        case FilterOperator.EQUALS:
          return held.includes(String(expected ?? ''));
        case FilterOperator.NOT_EQUALS:
          return !held.includes(String(expected ?? ''));
        case FilterOperator.IN:
          return Array.isArray(expected) && expected.map(String).some((one) => held.includes(one));
        case FilterOperator.NOT_IN:
          return !(
            Array.isArray(expected) && expected.map(String).some((one) => held.includes(one))
          );
        // A set that reached here is not empty — `readField` returns null for
        // a field holding nothing.
        case FilterOperator.IS_EMPTY:
          return false;
        case FilterOperator.IS_NOT_EMPTY:
          return true;
        default:
          // No other comparison has an honest answer against a set.
          return false;
      }
    }

    switch (comparison) {
      case FilterOperator.EQUALS:
        return String(actual ?? '') === String(expected ?? '');
      case FilterOperator.NOT_EQUALS:
        return String(actual ?? '') !== String(expected ?? '');
      case FilterOperator.CONTAINS:
        return String(actual ?? '')
          .toLowerCase()
          .includes(String(expected ?? '').toLowerCase());
      case FilterOperator.NOT_CONTAINS:
        return !String(actual ?? '')
          .toLowerCase()
          .includes(String(expected ?? '').toLowerCase());
      case FilterOperator.IS_EMPTY:
        return actual === null || actual === undefined || actual === '';
      case FilterOperator.IS_NOT_EMPTY:
        return actual !== null && actual !== undefined && actual !== '';
      case FilterOperator.IN:
        return Array.isArray(expected) && expected.map(String).includes(String(actual ?? ''));
      case FilterOperator.NOT_IN:
        return !(Array.isArray(expected) && expected.map(String).includes(String(actual ?? '')));
      /*
       * Never true for an empty field — see `numberComparison`. The inclusive
       * bounds are here because the builder offered them on every number field
       * and the translation table knew them, and this switch once did not — so
       * "at least 30" fell to the default and was false on every event.
       */
      case FilterOperator.GREATER_THAN:
      case FilterOperator.LESS_THAN:
      case FilterOperator.GREATER_THAN_OR_EQUAL:
      case FilterOperator.LESS_THAN_OR_EQUAL:
        return numberComparison(comparison, actual, expected);

      /*
       * Dates, compared as dates.
       *
       * These were missing entirely while the builder offered them for every
       * date field, so "due date is before Friday" published cleanly, fell
       * through to the default below, and could never match. A rule that is
       * accepted and then silently never fires is worse than one refused.
       *
       * Both sides go through `Date` rather than string comparison because the
       * stored value is an ISO timestamp and the configured one is usually a
       * plain `YYYY-MM-DD` — comparing those as text puts every timestamp after
       * every date. An unparseable side fails the check rather than throwing.
       *
       * Which way round is decided by the *translated* operator. This used to
       * test the stored one against `BEFORE`, and the builder stores
       * `IS_BEFORE` — so every "before" written in the panel ran as "after".
       */
      case FilterOperator.BEFORE:
      case FilterOperator.AFTER: {
        const left = new Date(String(actual ?? '')).getTime();
        const right = new Date(String(expected ?? '')).getTime();

        if (Number.isNaN(left) || Number.isNaN(right)) return false;

        return comparison === FilterOperator.BEFORE ? left < right : left > right;
      }

      default:
        // An unknown operator does not silently pass. A condition nobody can
        // evaluate must block the rule, not wave it through.
        return false;
    }
  }

  private readField(field: string, task: EvaluableTask, event: AutomationEvent): unknown {
    /*
     * A custom field's value, off the row loaded with the task.
     *
     * The key carries the field id — `customField:<id>` is what the catalogue
     * generates and the condition stores — and an absent row reads as null so
     * "is empty" holds for a field nobody has filled in.
     */
    if (field.startsWith('customField:')) {
      const fieldId = field.slice('customField:'.length);

      // A formula has no row: its number was worked out with the task.
      if (task.formulaValues?.has(fieldId)) return task.formulaValues.get(fieldId) ?? null;

      return customFieldActual(
        task.customFieldValues?.find((row) => row.customFieldId === fieldId),
      );
    }

    switch (field) {
      case 'status':
        return task.status;
      case 'priority':
        return task.priority;
      case 'sectionId':
        return task.sectionId;
      case 'assigneeId':
        return task.assigneeId;
      case 'createdById':
        return task.createdById;
      case 'title':
        return task.title;
      // Null rather than the empty string, so "description is empty" holds for
      // a task nobody has described — `IS_EMPTY` tests both, but a comparison
      // against text would otherwise match '' and read as a real answer.
      case 'description':
        return task.description;
      // Its own completion, or — on the event the roll-up raises when its last
      // subtask is finished — the checklist's. The label says "task or all
      // subtasks", and the condition has to mean both halves too.
      case 'completed':
        return task.completedAt !== null || event.after?.['allSubtasksCompleted'] === true;

      /*
       * The dates, which the condition catalogue has always offered and this
       * could not read.
       *
       * Falling through to the event payload below meant a due-date condition
       * only worked on an event that happened to carry one — so "due date is
       * before Friday" on a section move read `undefined` and failed. Together
       * with the missing date operators, such a rule was broken twice over and
       * silent both times.
       *
       * ISO strings, because that is what the configured side is compared
       * against and what the operators parse.
       */
      case 'dueDate':
        return task.dueDate?.toISOString() ?? null;
      case 'startDate':
        return task.startDate?.toISOString() ?? null;

      // The rest of the list view's columns: a number, and two dates the task
      // keeps for itself. `completedAt` is the day, where `completed` above is
      // the fact — a condition can ask either.
      case 'estimatedMinutes':
        return task.estimatedMinutes;
      case 'createdAt':
        return task.createdAt.toISOString();
      case 'completedAt':
        return task.completedAt?.toISOString() ?? null;

      // Facts counted with the task — see `TaskFacts`.
      case 'HAS_ATTACHMENT':
        return (task.facts?.attachments ?? 0) > 0;
      case 'HAS_COMMENT':
        return (task.facts?.comments ?? 0) > 0;
      case 'NO_LONGER_BLOCKED':
        return (task.facts?.openBlockers ?? 0) === 0;
      case 'TASK_TYPE':
        return task.kind;
      case 'APPROVAL_STATUS':
        return task.approvalStatus;
      case 'IS_SUBTASK':
        return task.parentTaskId !== null;

      default:
        return event.after?.[field];
    }
  }

  private async runAction(
    node: AutomationNode,
    task: EvaluableTask,
    rule: RunnableRule,
    event: AutomationEvent,
    /* When this execution began, so every action in one run agrees. */
    at: Date,
  ): Promise<ActionOutcome> {
    const config = (node.configuration ?? {}) as Record<string, unknown>;

    switch (node.subtype) {
      // A project's update, not the task's: the task only set the rule off.
      case AutomationAction.AI_DRAFT_UPDATE:
        return this.draftStatusUpdate(rule, config, at);

      /*
       * "Use AI…": the model chooses changes from what the step allows, and
       * each runs here as the action it stands for — the same checks, history
       * and follow-up events as if the rule's author had added it by hand.
       */
      case AutomationAction.AI_ACTION: {
        if (!this.ai?.available) {
          return { succeeded: false, message: 'AI isn’t set up on this server.' };
        }

        const decision = await this.ai.decide(task.id, rule, config, at);
        const done: string[] = [];
        const failed: string[] = [];
        const before: unknown[] = [];
        const after: unknown[] = [];
        const events: AutomationEvent[] = [];
        const webhooks: RuleWebhookRequest[] = [];
        const emails: RuleEmailRequest[] = [];

        for (const change of decision.changes) {
          const outcome = await this.runAction(
            {
              ...node,
              subtype: change.subtype,
              configuration: change.configuration as Prisma.JsonObject,
            },
            task,
            rule,
            event,
            at,
          ).catch((error: unknown): ActionOutcome => ({
            succeeded: false,
            message: error instanceof Error ? error.message : 'Action failed.',
          }));

          if (outcome.succeeded) done.push(change.describe);
          else failed.push(`could not ${change.describe} (${outcome.message ?? 'it failed'})`);
          before.push({ action: change.subtype, value: outcome.before ?? null });
          after.push({ action: change.subtype, value: outcome.after ?? null });
          events.push(...(outcome.events ?? []));
          webhooks.push(...(outcome.webhooks ?? []));
          emails.push(...(outcome.emails ?? []));
        }

        const words = [
          decision.changes.length === 0
            ? 'AI made no changes.'
            : `AI ${[...done, ...failed].join('; ')}.`,
          decision.summary,
          decision.ignored > 0
            ? `Ignored ${decision.ignored} suggestion${decision.ignored === 1 ? '' : 's'} outside what the step allows.`
            : '',
        ];

        return {
          succeeded: failed.length === 0,
          message: words.filter(Boolean).join(' '),
          before: before.length > 0 ? before : null,
          after: after.length > 0 ? after : null,
          events,
          webhooks,
          emails,
        };
      }

      /*
       * Nothing is sent from here. The runner has no queue and no HTTP client
       * — deliberately, so a slow endpoint cannot hold a rule open mid-run —
       * so the action decides *what* to send and hands the request back for
       * the processor to queue, exactly as it hands back events.
       */
      case AutomationAction.SEND_WEBHOOK: {
        const text = (value: unknown): string | null =>
          typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
        const endpointId = text(config['endpointId']);
        const rawUrl = text(config['url']);

        if (!endpointId && !rawUrl) {
          return { succeeded: false, message: 'Choose a webhook endpoint or enter a URL.' };
        }

        let destination: { endpointId: string | null; url: string; label: string };

        if (endpointId) {
          // Re-checked at execution time: the endpoint may have been deleted
          // or switched off since the rule was written.
          const endpoint = await this.prisma.webhookEndpoint.findFirst({
            where: { id: endpointId, workspaceId: rule.workspaceId },
            select: { id: true, url: true, name: true, enabled: true },
          });

          if (!endpoint) {
            return {
              succeeded: false,
              message: 'That webhook endpoint is no longer in this workspace.',
            };
          }
          if (!endpoint.enabled) {
            return {
              succeeded: false,
              message: `Webhook endpoint "${endpoint.name}" is disabled.`,
            };
          }
          destination = { endpointId: endpoint.id, url: endpoint.url, label: endpoint.name };
        } else {
          let parsed: URL;
          try {
            parsed = new URL(rawUrl as string);
          } catch {
            return { succeeded: false, message: 'The webhook URL is not a valid URL.' };
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return {
              succeeded: false,
              message: 'Webhooks are sent over https:// or http:// only.',
            };
          }
          // Whether the address is one CoreTask may call is decided where the
          // call is made, with the deployment's own setting.
          destination = { endpointId: null, url: parsed.toString(), label: parsed.host };
        }

        return {
          succeeded: true,
          message: `Queued a webhook to ${destination.label}`,
          after: { url: destination.url, endpointId: destination.endpointId },
          webhooks: [
            {
              workspaceId: rule.workspaceId,
              projectId: rule.projectId,
              ruleId: rule.id,
              nodeId: node.id,
              endpointId: destination.endpointId,
              url: destination.url,
              entityId: task.id,
              trigger: event.trigger,
              sourceEventId: event.eventId,
              correlationId: event.correlationId,
              actorId: event.actorId ?? null,
              extra: webhookExtraFields(config['extraFields']),
            },
          ],
        };
      }

      case AutomationAction.ASSIGN_USER: {
        const userId = String(config['userId'] ?? '');
        // Membership is re-checked at execution time: the rule may have been
        // written months ago and that person may have left since.
        const member = await this.prisma.workspaceMember.findFirst({
          where: { workspaceId: rule.workspaceId, userId },
          select: { id: true },
        });

        if (!member) {
          return { succeeded: false, message: 'That person is no longer in this workspace.' };
        }
        // And the project's: a rule gives work only to someone its pickers
        // offer — a member, or the workspace's owner.
        if (
          !(await isAssignable(
            this.prisma,
            rule.workspaceId,
            [task.projectId, rule.projectId],
            userId,
          ))
        ) {
          return { succeeded: false, message: NOT_A_PROJECT_MEMBER };
        }

        const before = task.assigneeId;
        const events = await this.updateTask(task, { assigneeId: userId }, rule, event);
        return { succeeded: true, before, after: userId, events };
      }

      case AutomationAction.UNASSIGN_USER: {
        const before = task.assigneeId;
        const events = await this.updateTask(task, { assigneeId: null }, rule, event);
        return { succeeded: true, before, after: null, events };
      }

      /*
       * The team responsible for the task — or none, for "clear the team".
       *
       * Re-checked as an assignee is: a team chosen months ago may have been
       * deleted since, and a team id from another workspace is not one this
       * rule can hand the task to. Written through `updateTask`, so it raises
       * TASK_UPDATED and records the change in the task's history like any
       * other field a rule sets.
       */
      case AutomationAction.ASSIGN_TEAM: {
        const teamId = typeof config['teamId'] === 'string' ? config['teamId'] : '';

        if (teamId !== '') {
          const team = await this.prisma.team.findFirst({
            where: { id: teamId, workspaceId: rule.workspaceId },
            select: { id: true },
          });
          if (!team) {
            return { succeeded: false, message: 'That team is no longer in this workspace.' };
          }
        } else if (config['clear'] !== true) {
          return { succeeded: false, message: 'This step has no team to assign.' };
        }

        const before = task.teamId;
        const events = await this.updateTask(
          task,
          { teamId: teamId === '' ? null : teamId },
          rule,
          event,
        );
        return { succeeded: true, before, after: teamId === '' ? null : teamId, events };
      }

      /*
       * A named checklist, added to the task with its items unticked.
       *
       * The name is text with variables, as a comment's body is; the items are
       * the step's own lines. A task holds a bounded number of checklists, and
       * a rule that has already added one to it adds another — a rule firing
       * twice is a rule configured to, and the log says what it did each time.
       */
      case AutomationAction.CREATE_CHECKLIST: {
        const { name: template, items } = checklistOf(config);
        const name = renderAutomationText(template, await this.textValues(task, rule, event, at))
          .trim()
          .slice(0, CHECKLIST_NAME_MAX);

        if (!name) return { succeeded: false, message: 'The checklist’s name came out empty.' };
        if (items.length === 0) {
          return { succeeded: false, message: 'This step has no items to add.' };
        }

        const existing = await this.prisma.taskChecklist.aggregate({
          where: { taskId: task.id },
          _count: { _all: true },
          _max: { position: true },
        });
        if (existing._count._all >= MAX_CHECKLISTS_PER_TASK) {
          return {
            succeeded: false,
            message: `The task already has ${MAX_CHECKLISTS_PER_TASK} checklists, which is as many as one holds.`,
          };
        }

        const checklist = await this.prisma.taskChecklist.create({
          data: {
            workspaceId: rule.workspaceId,
            taskId: task.id,
            name,
            position: (existing._max.position ?? 0) + POSITION_STEP,
            createdById: event.actorId ?? null,
            items: {
              create: items.map((title, index) => ({
                title,
                position: (index + 1) * POSITION_STEP,
              })),
            },
          },
          select: { id: true },
        });

        return {
          succeeded: true,
          message: `Added the checklist “${name}” with ${items.length} item${items.length === 1 ? '' : 's'}`,
          after: { checklistId: checklist.id, name, items: items.length },
        };
      }

      case AutomationAction.MOVE_TO_SECTION: {
        const sectionId = String(config['sectionId'] ?? '');
        const section = await this.prisma.section.findFirst({
          where: { id: sectionId, projectId: rule.projectId },
          select: { id: true },
        });

        if (!section) {
          return { succeeded: false, message: 'That section is not in this project.' };
        }

        const before = task.sectionId;

        // A rule in a project the task is linked into moves it on that board.
        if (task.projectId && task.projectId !== rule.projectId) {
          await this.prisma.taskProject.update({
            where: { taskId_projectId: { taskId: task.id, projectId: rule.projectId } },
            data: {
              sectionId,
              position: await endOfSection(
                this.prisma,
                rule.workspaceId,
                rule.projectId,
                sectionId,
              ),
            },
          });
          return { succeeded: true, before, after: sectionId };
        }

        const events = await this.updateTask(task, { sectionId }, rule, event);
        return { succeeded: true, before, after: sectionId, events };
      }

      case AutomationAction.MOVE_TO_PROJECT: {
        const projectId = String(config['projectId'] ?? '');
        const requestedSectionId = String(config['targetSectionId'] ?? '');

        // "Add task to another project": it stays where it is, and shows there too.
        if (config['mode'] === 'ADD') {
          return this.addToProject(task, rule, event, projectId, requestedSectionId);
        }

        if (projectId === task.projectId) {
          return { succeeded: false, message: 'The task is already in that project.' };
        }

        /*
         * A rule in a project the task is linked into moves it out of that
         * project and into the other — its link moves, its home stays. Into a
         * project it is already in, the link simply goes.
         */
        if (task.projectId && task.projectId !== rule.projectId) {
          const target = await this.prisma.project.findFirst({
            where: { id: projectId, workspaceId: rule.workspaceId, archivedAt: null },
            select: { id: true, sections: { orderBy: { position: 'asc' }, select: { id: true } } },
          });
          if (!target) {
            return { succeeded: false, message: 'That project is no longer in this workspace.' };
          }
          await this.prisma.taskProject.deleteMany({
            where: { taskId: task.id, projectId: rule.projectId },
          });
          const alreadyThere = await this.prisma.taskProject.findUnique({
            where: { taskId_projectId: { taskId: task.id, projectId } },
          });
          const linkSection =
            (requestedSectionId
              ? target.sections.find((row) => row.id === requestedSectionId)?.id
              : target.sections[0]?.id) ?? null;
          if (!alreadyThere) {
            await this.prisma.taskProject.create({
              data: {
                taskId: task.id,
                projectId,
                sectionId: linkSection,
                position: await endOfSection(this.prisma, rule.workspaceId, projectId, linkSection),
              },
            });
          }
          return {
            succeeded: true,
            before: { projectId: rule.projectId, sectionId: task.sectionId },
            after: { projectId, sectionId: linkSection },
          };
        }

        // Re-checked at execution time, as a section is: the project may have
        // been archived since the rule was written, and a project in another
        // workspace is a tenant boundary, not a destination.
        const project = await this.prisma.project.findFirst({
          where: { id: projectId, workspaceId: rule.workspaceId, archivedAt: null },
          select: {
            id: true,
            sections: { orderBy: { position: 'asc' }, select: { id: true } },
          },
        });

        if (!project) {
          return { succeeded: false, message: 'That project is no longer in this workspace.' };
        }

        // The chosen section, or the project's first — where a task dropped on
        // a board with no column named lands. A project with no sections at
        // all takes the task sectionless, which its list view still shows.
        const section = requestedSectionId
          ? project.sections.find((row) => row.id === requestedSectionId)
          : project.sections[0];

        if (requestedSectionId && !section) {
          return {
            succeeded: false,
            message: 'That section is no longer in the chosen project.',
          };
        }

        const sectionId = section?.id ?? null;

        // Last in its new column, as a card dragged across lands. The old
        // position meant something only among the old siblings.
        const siblings = await this.prisma.task.findMany({
          where: {
            workspaceId: rule.workspaceId,
            archivedAt: null,
            parentTaskId: null,
            parentTicketId: null,
            ...(sectionId ? { sectionId } : { sectionId: null, projectId: project.id }),
          },
          orderBy: { position: 'asc' },
          select: { id: true, position: true },
        });

        const before = { projectId: task.projectId, sectionId: task.sectionId };

        /*
         * What the task carries, decided rather than left to chance.
         *
         * Custom field values are the workspace's and stay: a field the new
         * project does not show is not shown, and the value is there again
         * if the task ever comes back. Statuses can be a project's own, so
         * the definition is remapped where the new project would not list
         * it. Priorities are workspace-wide and need nothing.
         */
        const events = await this.updateTask(
          task,
          {
            projectId: project.id,
            sectionId,
            position: appendPosition(siblings),
            ...(await this.statusInProject(rule.workspaceId, project.id, task.statusDefinitionId)),
          },
          rule,
          event,
        );

        // Subtasks that sit in the task's project go with it — a child left in
        // one project under a parent in another would show up nowhere useful.
        // Subtasks that belong to no project are left as they are.
        if (before.projectId) {
          await this.prisma.task.updateMany({
            where: { parentTaskId: task.id, projectId: before.projectId },
            data: { projectId: project.id, sectionId },
          });
        }
        // Its new home may have been one of its other projects: not twice.
        await dropLinkToHome(this.prisma, task.id, project.id);

        return { succeeded: true, before, after: { projectId: project.id, sectionId }, events };
      }

      case AutomationAction.UPDATE_STATUS: {
        const status = readActionId(config, 'status');
        if (!status) return { succeeded: false, message: 'No status was chosen.' };

        const data = statusData(status);
        const before = task.status;

        // Completion is a fact about the task, not a separate action somebody
        // has to remember to add to the rule. Kept in step the way a person's
        // edit keeps it, so TASK_COMPLETED means it — including when the
        // status is one the workspace defined rather than a legacy enum.
        const completion = await completionData(this.prisma, status, task.completedAt);

        const events = await this.updateTask(task, { ...data, ...completion }, rule, event);

        return { succeeded: true, before, after: status, events };
      }

      case AutomationAction.UPDATE_PRIORITY: {
        const priority = readActionId(config, 'priority');
        if (!priority) return { succeeded: false, message: 'No priority was chosen.' };

        const before = task.priority;
        const events = await this.updateTask(task, priorityData(priority), rule, event);

        return { succeeded: true, before, after: priority, events };
      }

      case AutomationAction.SET_DUE_DATE: {
        // Relative rather than absolute: "due in three days" or "Tuesday next
        // week" stays meaningful, where a fixed date written into a rule is
        // stale the week after.
        //
        // A rule sets a day, not a moment: the calendar date at UTC midnight,
        // the shape every date column holds, and no time of day carried over
        // from whatever the task had before.
        const dueDate = dueDateFor(config, new Date());
        const before = task.dueDate;
        const events = await this.updateTask(task, { dueDate, dueAt: null }, rule, event);
        return { succeeded: true, before, after: dueDate.toISOString(), events };
      }

      case AutomationAction.CLEAR_DUE_DATE: {
        const before = task.dueDate;
        const events = await this.updateTask(task, { dueDate: null, dueAt: null }, rule, event);
        return { succeeded: true, before, after: null, events };
      }

      // The start date, handled exactly as the due date is: a day counted from
      // now, written at UTC midnight with no time of day carried over.
      case AutomationAction.SET_START_DATE: {
        const days = Number(config['daysFromNow'] ?? 0);
        const start = new Date();
        start.setUTCDate(start.getUTCDate() + days);

        const startDate = toCalendarDate(start);
        const before = task.startDate;
        const events = await this.updateTask(task, { startDate, startAt: null }, rule, event);
        return { succeeded: true, before, after: startDate.toISOString(), events };
      }

      case AutomationAction.CLEAR_START_DATE: {
        const before = task.startDate;
        const events = await this.updateTask(task, { startDate: null, startAt: null }, rule, event);
        return { succeeded: true, before, after: null, events };
      }

      case AutomationAction.SET_ESTIMATE: {
        // Whole minutes, as the column holds them. Refused rather than rounded:
        // a rule that wrote 89 for "89.6" has done something nobody asked.
        const minutes = Number(config['minutes']);
        if (!Number.isInteger(minutes) || minutes < 0) {
          return { succeeded: false, message: 'The estimate has to be a whole number of minutes.' };
        }

        const before = task.estimatedMinutes;
        const events = await this.updateTask(task, { estimatedMinutes: minutes }, rule, event);
        return { succeeded: true, before, after: minutes, events };
      }

      case AutomationAction.SEND_EMAIL: {
        const values = await this.textValues(task, rule, event, at);
        const subject = renderAutomationText(String(config['subject'] ?? ''), values)
          .trim()
          .slice(0, AUTOMATION_EMAIL_SUBJECT_MAX);
        if (!subject) return { succeeded: false, message: 'The email has no subject.' };
        const body = renderAutomationText(String(config['body'] ?? ''), values).trim();

        const who = emailRecipientsOf(config);
        if (who.length === 0) return { succeeded: false, message: 'Nobody is chosen to email.' };

        const ids = new Set<string>();
        if (who.includes(AutomationEmailRecipient.ASSIGNEE) && task.assigneeId) {
          ids.add(task.assigneeId);
        }
        if (who.includes(AutomationEmailRecipient.CREATOR)) ids.add(task.createdById);
        if (who.includes(AutomationEmailRecipient.COLLABORATORS)) {
          const followers = await this.prisma.follower.findMany({
            where: { taskId: task.id },
            select: { userId: true },
          });
          for (const follower of followers) ids.add(follower.userId);
        }

        // Only people still in the workspace hear from it.
        const members = await this.prisma.workspaceMember.findMany({
          where: { workspaceId: rule.workspaceId, userId: { in: [...ids] } },
          select: { user: { select: { email: true } } },
          take: MAX_EMAIL_RECIPIENTS,
        });
        if (members.length === 0) {
          return {
            succeeded: true,
            message: 'Nobody to email: the task has none of those people.',
          };
        }

        return {
          succeeded: true,
          message: `Queued an email to ${members.length} ${members.length === 1 ? 'person' : 'people'}`,
          after: { recipients: members.length },
          emails: members.map((member) => ({
            to: member.user.email,
            subject,
            body,
            taskId: task.id,
            taskTitle: task.title,
            ruleName: rule.name,
          })),
        };
      }

      case AutomationAction.ADD_COMMENT: {
        const body = renderAutomationText(
          String(config['body'] ?? ''),
          await this.textValues(task, rule, event, at),
        ).trim();
        if (!body) return { succeeded: false, message: 'The comment is empty.' };

        // Authored by whoever caused the trigger, because a comment needs an
        // author and the rule is not a person. Falls back to the task creator.
        await this.prisma.comment.create({
          data: {
            workspaceId: rule.workspaceId,
            authorId: event.actorId ?? task.createdById,
            body,
            taskId: task.id,
          },
        });

        return { succeeded: true, after: body.slice(0, 100) };
      }

      case AutomationAction.SEND_IN_APP_NOTIFICATION: {
        const userId = String(config['userId'] ?? task.assigneeId ?? '');
        if (!userId) return { succeeded: false, message: 'Nobody to notify.' };

        await this.prisma.notification.create({
          data: {
            userId,
            workspaceId: rule.workspaceId,
            type: NotificationType.TASK_ASSIGNED,
            title: String(config['title'] ?? `Automation updated "${task.title}"`),
            body: config['body'] ? String(config['body']) : null,
            entity: 'TASK',
            entityId: task.id,
            actionUrl: `/my-tasks?task=${task.id}`,
          },
        });

        return { succeeded: true, after: userId };
      }

      case AutomationAction.CREATE_SUBTASK: {
        const listed = subtaskEntries(config);
        if (listed.length === 0) {
          return { succeeded: false, message: 'The subtasks have no titles.' };
        }
        // Titles may name the task the rule acted on — "Inspect {{task.name}}".
        const values = await this.textValues(task, rule, event, at);

        /*
         * "Let AI decide the number of subtasks to create": the model keeps
         * the rows this task needs, by number, and the rest of this case runs
         * on those alone. It reads the titles as they will be written.
         */
        let entries = listed;
        let aiNote = '';
        if (aiDecidesSubtasks(config)) {
          if (!this.ai?.available) {
            return { succeeded: false, message: 'AI isn’t set up on this server.' };
          }
          const choice = await this.ai.chooseSubtasks(
            task.id,
            rule,
            listed.map((entry) => renderAutomationText(entry.title, values).trim() || entry.title),
            at,
          );
          entries = choice.keep.flatMap((index) => {
            const entry = listed[index];
            return entry ? [entry] : [];
          });
          aiNote = `AI chose ${entries.length} of ${listed.length} subtasks.${choice.reason ? ` ${choice.reason}` : ''}`;

          if (entries.length === 0) {
            return { succeeded: true, message: aiNote };
          }
        }

        /*
         * Membership is re-checked at execution time, as ASSIGN_USER's is —
         * the workspace's and the project's — but a person who has left costs
         * their row its assignee, not the checklist its existence. The rule's
         * job is the subtasks; a departed name is reported in the log here and
         * refused by the validator the next time the rule is edited.
         */
        const named = [
          ...new Set(entries.flatMap((entry) => (entry.assigneeId ? [entry.assigneeId] : []))),
        ];
        const [members, assignable] = named.length
          ? await Promise.all([
              this.prisma.workspaceMember.findMany({
                where: { workspaceId: rule.workspaceId, userId: { in: named } },
                select: { userId: true },
              }),
              assignableIds(this.prisma, rule.workspaceId, [task.projectId, rule.projectId]),
            ])
          : [[], null];
        const live = new Set(
          members
            .map((member) => member.userId)
            .filter((userId) => assignable?.has(userId) ?? true),
        );
        let departed = 0;

        /*
         * Real positions, appended after whatever the task already holds.
         *
         * These used to be created with the column's default — every row at 0 —
         * and the detail view orders by position alone, so ties came back in
         * whatever order PostgreSQL felt like: a checklist written as 1-2-3
         * displayed as 3-4-2-1. The list is the order somebody wrote it in,
         * and the position column is where that order lives.
         */
        const siblings = await this.prisma.task.findMany({
          where: { workspaceId: rule.workspaceId, parentTaskId: task.id, archivedAt: null },
          orderBy: { position: 'asc' },
          select: { id: true, position: true },
        });
        let position = appendPosition(siblings);

        const created: string[] = [];
        const events: AutomationEvent[] = [];

        // One by one rather than createMany: the ids come back for the log.
        for (const entry of entries) {
          const assigneeId =
            entry.assigneeId && live.has(entry.assigneeId) ? entry.assigneeId : null;
          if (entry.assigneeId && !assigneeId) departed += 1;

          const subtask = await this.prisma.task.create({
            data: {
              workspaceId: rule.workspaceId,
              projectId: task.projectId,
              sectionId: task.sectionId,
              parentTaskId: task.id,
              title:
                renderAutomationText(entry.title, values).trim().slice(0, TASK_TITLE_MAX_LENGTH) ||
                entry.title,
              assigneeId,
              // A day, not a moment — the shape every date column holds, and
              // what SET_DUE_DATE writes. `dueAt` stays null: all day.
              dueDate: subtaskDueDate(entry, at),
              position,
              createdById: event.actorId ?? task.createdById,
            },
          });

          // An assignee follows the task, as one a rule assigns later does —
          // see `updateTask`. Membership was checked above.
          if (assigneeId) {
            await this.prisma.follower.createMany({
              data: [
                {
                  workspaceId: rule.workspaceId,
                  userId: assigneeId,
                  taskId: subtask.id,
                  ticketId: null,
                },
              ],
              skipDuplicates: true,
            });
          }

          created.push(subtask.id);
          position += POSITION_STEP;

          // A subtask is a task in this project, and a person creating one
          // raises TASK_CREATED — so a rule creating one does too, or a rule
          // that greets every new task would miss exactly the ones rules make.
          events.push(
            this.follow(rule, event, AutomationTrigger.TASK_CREATED, subtask.id, undefined, {
              title: subtask.title,
              sectionId: subtask.sectionId,
              assigneeId: subtask.assigneeId,
              dueDate: subtask.dueDate?.toISOString() ?? null,
            }),
          );
        }

        const notes = [
          aiNote,
          departed > 0
            ? `${departed} subtask${departed === 1 ? ' was' : 's were'} left unassigned: the person named is no longer in this workspace or this project.`
            : '',
        ].filter(Boolean);

        return {
          succeeded: true,
          after: created.join(', '),
          ...(notes.length > 0 ? { message: notes.join(' ') } : {}),
          events,
        };
      }

      case AutomationAction.SET_COMPLETION: {
        // Absent means "complete" — the commoner half, and the form's default.
        const complete = config['completed'] !== false;

        if ((task.completedAt !== null) === complete) {
          return {
            succeeded: true,
            message: complete ? 'The task was already complete.' : 'The task was already open.',
          };
        }

        const statusId = await this.completionStatus(rule.workspaceId, task.projectId, complete);
        const before = task.completedAt !== null;
        const completion = await completionData(this.prisma, statusId, task.completedAt);
        const events = await this.updateTask(
          task,
          { ...statusData(statusId), ...completion },
          rule,
          event,
        );

        return { succeeded: true, before, after: complete, events };
      }

      case AutomationAction.REMOVE_FROM_PROJECT: {
        if (!task.projectId) {
          return { succeeded: true, message: 'The task was not in a project.' };
        }

        const before = { projectId: task.projectId, sectionId: task.sectionId };

        // A rule in a project the task is linked into takes it off that board
        // only; its home and its other projects keep it.
        if (task.projectId !== rule.projectId) {
          await this.prisma.taskProject.deleteMany({
            where: { taskId: task.id, projectId: rule.projectId },
          });
          return {
            succeeded: true,
            before: { projectId: rule.projectId, sectionId: task.sectionId },
            after: { projectId: null, sectionId: null },
          };
        }

        // Leaving its home while in other projects: the one it joined first
        // becomes its home, subtasks and all.
        if ((await this.prisma.taskProject.count({ where: { taskId: task.id } })) > 0) {
          const placement = await leaveHome(this.prisma, task.id);
          return { succeeded: true, before, after: placement };
        }

        /*
         * No events. A removal raises a "moved" event in the project the task
         * just left, and a rule there answering every move by moving the task
         * into a section would put a sectioned task back with no project — so
         * a task leaving is the end of this project's interest in it.
         */
        await this.updateTask(task, { projectId: null, sectionId: null }, rule, event);

        // Its subtasks in this project leave with it, as they follow a move.
        await this.prisma.task.updateMany({
          where: { parentTaskId: task.id, projectId: before.projectId },
          data: { projectId: null, sectionId: null },
        });

        return { succeeded: true, before, after: { projectId: null, sectionId: null } };
      }

      case AutomationAction.CREATE_TASK:
        return this.createTask(config, task, rule, event, at);

      case AutomationAction.SET_TASK_TYPE: {
        const kind = config['kind'];
        if (!(TASK_KINDS as readonly unknown[]).includes(kind)) {
          return { succeeded: false, message: 'No task type was chosen.' };
        }
        const next = kind as TaskKind;
        const before = task.kind;
        // Converting is all it does: an approval starts pending, anything
        // else carries no decision.
        const events = await this.updateTask(
          task,
          {
            kind: next,
            approvalStatus: next === 'APPROVAL' ? (task.approvalStatus ?? 'PENDING') : null,
          },
          rule,
          event,
        );
        return { succeeded: true, before, after: next, events };
      }

      case AutomationAction.ADD_REMOVE_COLLABORATORS: {
        const people = (key: string): string[] =>
          Array.isArray(config[key])
            ? [
                ...new Set(
                  (config[key] as unknown[]).filter(
                    (value): value is string => typeof value === 'string' && value !== '',
                  ),
                ),
              ]
            : [];

        const add = people('add');
        // Somebody named on both sides is added: the narrower instruction wins.
        const remove = people('remove').filter((id) => !add.includes(id));

        if (add.length === 0 && remove.length === 0) {
          return { succeeded: false, message: 'Nobody was chosen to add or remove.' };
        }

        // Re-checked now, as an assignment is: the rule may be months old.
        const members = add.length
          ? await this.prisma.workspaceMember.findMany({
              where: { workspaceId: rule.workspaceId, userId: { in: add } },
              select: { userId: true },
            })
          : [];
        const addable = members.map((member) => member.userId);

        const already = new Set(
          (
            await this.prisma.follower.findMany({
              where: { taskId: task.id, userId: { in: addable } },
              select: { userId: true },
            })
          ).map((row) => row.userId),
        );
        const added = addable.filter((userId) => !already.has(userId));

        if (added.length) {
          await this.prisma.follower.createMany({
            data: added.map((userId) => ({
              workspaceId: rule.workspaceId,
              userId,
              taskId: task.id,
              ticketId: null,
            })),
            skipDuplicates: true,
          });
        }

        const removed = remove.length
          ? (
              await this.prisma.follower.deleteMany({
                where: { taskId: task.id, userId: { in: remove } },
              })
            ).count
          : 0;

        const departed = add.length - addable.length;

        return {
          succeeded: true,
          after: { added, removed },
          ...(departed > 0
            ? {
                message: `${departed} ${departed === 1 ? 'person is' : 'people are'} no longer in this workspace and ${departed === 1 ? 'was' : 'were'} not added.`,
              }
            : {}),
          // Each new collaborator is an arrival a rule can answer.
          events: added.map((userId) =>
            this.follow(rule, event, AutomationTrigger.COLLABORATOR_ADDED, task.id, undefined, {
              userId,
            }),
          ),
        };
      }

      case AutomationAction.SET_TASK_NAME: {
        const title = renderAutomationText(
          String(config['text'] ?? ''),
          await this.textValues(task, rule, event, at),
        )
          .trim()
          .slice(0, TASK_TITLE_MAX_LENGTH);

        // A task with no name is not one anybody can find again.
        if (!title) return { succeeded: false, message: 'The new name came out empty.' };

        const before = task.title;
        const events = await this.updateTask(task, { title }, rule, event);
        return { succeeded: true, before, after: title, events };
      }

      case AutomationAction.SET_TASK_DESCRIPTION: {
        const text = renderAutomationText(
          String(config['text'] ?? ''),
          await this.textValues(task, rule, event, at),
        ).trim();

        // Stored as the editor stores it — escaped, one paragraph per line —
        // and an empty result clears the description rather than writing <p></p>.
        const description = text ? plainTextToHtml(text) : null;
        const before = task.description;
        const events = await this.updateTask(task, { description }, rule, event);
        return { succeeded: true, before, after: text.slice(0, 100), events };
      }

      case AutomationAction.SET_CUSTOM_FIELD: {
        const fieldId = readActionId(config, 'fieldId') ?? '';
        // Through the association: a rule may only write a field its own
        // project actually uses, even though the definition is shared.
        const field = await this.prisma.customField.findFirst({
          where: { id: fieldId, projects: { some: { projectId: rule.projectId } } },
          select: {
            id: true,
            name: true,
            type: true,
            settings: true,
            options: { select: { id: true, label: true } },
            projects: { where: { projectId: rule.projectId }, select: { notifyOnChange: true } },
          },
        });

        if (!field) return { succeeded: false, message: 'That field is not in this project.' };

        // Worked out on read: whatever a rule wrote would be replaced by the
        // next read, so the write is refused rather than quietly lost.
        if (isComputedFieldType(field.type as CustomFieldType)) {
          return {
            succeeded: false,
            message: `"${field.name}" is calculated and cannot be set by a rule.`,
          };
        }

        const previous =
          task.customFieldValues?.find((row) => row.customFieldId === field.id) ?? null;

        const written = await this.prisma.taskCustomFieldValue.upsert({
          where: { taskId_customFieldId: { taskId: task.id, customFieldId: field.id } },
          create: {
            taskId: task.id,
            customFieldId: field.id,
            ...customFieldValue(field.type, resolveValue(config['value'], at)),
          },
          update: customFieldValue(field.type, resolveValue(config['value'], at)),
        });

        // The row in hand is replaced, so a later action in this run reads the
        // value that is now true rather than the one loaded at the start.
        if (task.customFieldValues) {
          task.customFieldValues = [
            ...task.customFieldValues.filter((row) => row.customFieldId !== field.id),
            written,
          ];
        }

        /*
         * Announced the way `CustomFieldsService` announces a person's edit —
         * the id and the name, and the value as the API shapes it — so a rule
         * narrowed to this field, or reading the value off the event, sees one
         * shape whichever of the two wrote it. Nothing is announced when the
         * value did not change: a rule re-writing what is already there has
         * not changed the field, and saying it had would wake every rule
         * listening for one.
         */
        const before = previous ? toValueDto(previous) : null;
        const after = toValueDto(written);
        const events = sameValue(before, after)
          ? []
          : [
              this.follow(
                rule,
                event,
                AutomationTrigger.CUSTOM_FIELD_CHANGED,
                task.id,
                { fieldId: field.id, fieldName: field.name, value: before },
                { fieldId: field.id, fieldName: field.name, value: after },
              ),
            ];

        if (events.length > 0) {
          await this.recordFieldChange(
            rule,
            event,
            task,
            { ...field, notifyOnChange: field.projects[0]?.notifyOnChange ?? false },
            before,
            after,
          );
        }

        return { succeeded: true, after: resolveValue(config['value'], at), events };
      }

      default:
        // An action the engine does not implement fails loudly rather than
        // reporting success for something that did not happen.
        return {
          succeeded: false,
          message: `"${node.subtype}" is not an action this engine runs.`,
        };
    }
  }

  /**
   * Writes a task change and says which events it amounts to.
   *
   * The events are the ones a person making the same change would raise —
   * derived the way `TasksService` and `ProjectWorkItemService` derive them —
   * so a rule listening for a section move fires whether a hand or another
   * rule did the moving. That is what makes rules composable: "when the field
   * changes, move it" and "when it arrives, add the checklist" are two rules
   * somebody writes separately and expects to work together, and until this
   * was here the second only ran when the task was dragged by hand.
   *
   * A write that changed nothing raises nothing. Assigning the person already
   * assigned is not an assignment, and announcing it would wake every rule
   * listening for one — a loop with extra steps.
   *
   * The task in hand is updated in place, so the next action in the same run —
   * and the next rule on the same event, which shares the row — reads what is
   * now true rather than what was true when the run began. Conditions never
   * read this row; they read the copy taken before the first rule ran.
   *
   * The events are returned, not published: the runner has no queue,
   * deliberately, so it never waits on Redis while holding a database
   * connection mid-execution. The processor publishes them after the run.
   */
  private async updateTask(
    task: EvaluableTask,
    data: Prisma.TaskUncheckedUpdateInput,
    rule: { id: string; workspaceId: string },
    event: AutomationEvent,
  ): Promise<AutomationEvent[]> {
    const before: Task = { ...task };
    const updated = await this.prisma.task.update({ where: { id: task.id }, data });
    Object.assign(task, updated);

    const changed = (Object.keys(data) as (keyof Task)[]).filter(
      (key) => key in updated && !same(before[key], updated[key]),
    );

    if (changed.length === 0) return [];

    await this.recordStories(before, updated, rule, event);

    // A rule completing a repeating task makes its next occurrence, as a
    // person completing it would.
    if (before.completedAt === null && updated.completedAt !== null) {
      await spawnNextOccurrence(this.prisma, task.id, event.actorId ?? null);
    }

    /*
     * An assignee follows the task, whether a person or a rule assigned them.
     * Written through Prisma like every other write here — this module stays
     * clear of the request-side graph — with the same membership check the
     * followers service applies, so a rule cannot subscribe an outsider.
     */
    if (changed.includes('assigneeId') && updated.assigneeId) {
      const member = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: rule.workspaceId, userId: updated.assigneeId },
        select: { userId: true },
      });
      if (member) {
        await this.prisma.follower.createMany({
          data: [
            {
              workspaceId: rule.workspaceId,
              userId: updated.assigneeId,
              taskId: task.id,
              ticketId: null,
            },
          ],
          skipDuplicates: true,
        });
      }
    }

    const triggers: AutomationTrigger[] = [];

    if (changed.includes('sectionId') || changed.includes('projectId')) {
      // A move is a move, not an update: the paths a person takes publish
      // exactly this for a drag between columns and nothing else. A change
      // of project is the same event raised in the project the task is now
      // in — see `follow` — so the rules there see it arrive.
      triggers.push(AutomationTrigger.TASK_MOVED_TO_SECTION);
    } else {
      triggers.push(AutomationTrigger.TASK_UPDATED);

      if (changed.includes('status') || changed.includes('statusDefinitionId')) {
        triggers.push(AutomationTrigger.TASK_STATUS_CHANGED);
      }
      if (changed.includes('priority') || changed.includes('priorityDefinitionId')) {
        triggers.push(AutomationTrigger.TASK_PRIORITY_CHANGED);
      }
      if (changed.includes('assigneeId') && updated.assigneeId) {
        triggers.push(AutomationTrigger.TASK_ASSIGNED);
      }
      if (before.completedAt === null && updated.completedAt !== null) {
        triggers.push(AutomationTrigger.TASK_COMPLETED);
      }
      if (changed.includes('kind')) triggers.push(AutomationTrigger.TASK_TYPE_CHANGED);
      if (changed.includes('approvalStatus') && updated.approvalStatus) {
        triggers.push(AutomationTrigger.APPROVAL_STATUS_CHANGED);
      }
      // The fields a rule can watch on their own, raised for a rule's write
      // exactly as for a person's — see `TasksService.update`.
      triggers.push(...fieldChangeTriggers(changed));
    }

    return triggers.map((trigger) =>
      this.follow(
        rule,
        event,
        trigger,
        task.id,
        snapshot(before),
        snapshot(updated),
        // Raised in the project the task is in *now*: after a move to another
        // project, the rules that should hear about it are that project's.
        updated.projectId ?? undefined,
      ),
    );
  }

  /**
   * "Add task to another project" — multi-homing from a rule. The task keeps
   * its home and its place here, and gains a place in the other project: the
   * section chosen, or that project's first.
   *
   * Already there, it moves to the chosen section, as Asana's "add to project
   * in section" does. That is how a rule in one project moves a task on in
   * another it also lives in: "added to New PM Lease Starting" puts its card
   * in New Lease Starting at IN LEASE. With no section chosen, or already in
   * it, there is nothing to do, and it says so rather than failing, so a rule
   * that runs twice stays quiet.
   */
  private async addToProject(
    task: EvaluableTask,
    rule: RunnableRule,
    event: AutomationEvent,
    projectId: string,
    requestedSectionId: string,
  ): Promise<ActionOutcome> {
    const target = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: rule.workspaceId, archivedAt: null },
      select: { id: true, sections: { orderBy: { position: 'asc' }, select: { id: true } } },
    });
    if (!target) {
      return { succeeded: false, message: 'That project is no longer in this workspace.' };
    }

    const sectionId =
      (requestedSectionId
        ? target.sections.find((row) => row.id === requestedSectionId)?.id
        : target.sections[0]?.id) ?? null;
    if (requestedSectionId && !sectionId) {
      return { succeeded: false, message: 'That section is no longer in the chosen project.' };
    }

    const linked = await this.prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId: task.id, projectId } },
      select: { sectionId: true },
    });
    if (task.projectId === projectId || linked) {
      const from = task.projectId === projectId ? task.sectionId : (linked?.sectionId ?? null);
      if (!requestedSectionId || from === sectionId) {
        return { succeeded: true, message: 'The task is already in that project.' };
      }
      return this.moveWithin(task, rule, event, projectId, from, sectionId);
    }

    await this.prisma.taskProject.create({
      data: {
        taskId: task.id,
        projectId,
        sectionId,
        addedById: event.actorId ?? null,
        position: await endOfSection(this.prisma, rule.workspaceId, projectId, sectionId),
      },
    });
    return { succeeded: true, before: null, after: { projectId, sectionId } };
  }

  /**
   * A task already in another project, moved to one of that project's
   * sections: its own section when that project is its home, its place there
   * when it is linked in. Either way the move is raised in that project, so
   * its "moved to a section" rules see it, as they see a person's drag.
   */
  private async moveWithin(
    task: EvaluableTask,
    rule: RunnableRule,
    event: AutomationEvent,
    projectId: string,
    from: string | null,
    sectionId: string | null,
  ): Promise<ActionOutcome> {
    const before = { projectId, sectionId: from };
    const after = { projectId, sectionId };

    if (task.projectId === projectId) {
      const events = await this.updateTask(task, { sectionId }, rule, event);
      return { succeeded: true, before, after, events };
    }

    await this.prisma.taskProject.update({
      where: { taskId_projectId: { taskId: task.id, projectId } },
      data: {
        sectionId,
        position: await endOfSection(this.prisma, rule.workspaceId, projectId, sectionId),
      },
    });
    return {
      succeeded: true,
      before,
      after,
      events: [
        this.follow(
          rule,
          event,
          AutomationTrigger.TASK_MOVED_TO_SECTION,
          task.id,
          { sectionId: from },
          { sectionId },
          projectId,
        ),
      ],
    };
  }

  /**
   * "Create a task…" — with or without a task the rule is acting on.
   *
   * Lands in this project, in the chosen section or the first one, last in its
   * column as a task added there by hand would be. The name and description can
   * use variables, which name the task the rule acted on when there is one.
   * Credited to whoever set the rule off, then the rule's author, then the
   * workspace owner: a task needs a creator, and a rule is not a person.
   */
  /**
   * "Draft an update with AI…": the model drafts the project's status update
   * and it waits as a draft — replacing any earlier one — for a person to
   * review and post. The rule never posts it: a status is a person's word on
   * the project, and members are told when one is posted.
   *
   * Whoever would be asked for an update hears there is a draft: the
   * project's owner, else whoever posted the last update, else the rule's
   * author — each only while still in the workspace.
   */
  private async draftStatusUpdate(
    rule: RunnableRule,
    config: Record<string, unknown>,
    at: Date,
  ): Promise<ActionOutcome> {
    if (!this.ai?.available) {
      return { succeeded: false, message: 'AI isn’t set up on this server.' };
    }

    const instructions = typeof config['instructions'] === 'string' ? config['instructions'] : '';
    const draft = await this.ai.draftStatusUpdate(rule, instructions, at);
    const fields = {
      ruleId: rule.id,
      status: draft.status,
      title: draft.title,
      summary: draft.summary || null,
      nextSteps: draft.nextSteps || null,
    };
    const row = await this.prisma.projectStatusDraft.upsert({
      where: { projectId: rule.projectId },
      create: { workspaceId: rule.workspaceId, projectId: rule.projectId, ...fields },
      update: { ...fields, createdAt: new Date() },
    });

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: rule.projectId },
      select: {
        name: true,
        leadId: true,
        statusUpdates: { orderBy: { createdAt: 'desc' }, take: 1, select: { authorId: true } },
      },
    });
    const candidates = [project.leadId, project.statusUpdates[0]?.authorId, rule.createdById];
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId: rule.workspaceId,
        userId: { in: candidates.filter((id): id is string => Boolean(id)) },
      },
      select: { userId: true },
    });
    const present = new Set(members.map((member) => member.userId));
    const reviewer = candidates.find(
      (id): id is string => Boolean(id) && present.has(id as string),
    );

    const label = PROJECT_STATUS_LABEL[draft.status];
    if (reviewer) {
      await this.prisma.notification.create({
        data: {
          userId: reviewer,
          workspaceId: rule.workspaceId,
          type: NotificationType.PROJECT_UPDATE,
          title: `AI drafted a status update for ${project.name}`.slice(0, 200),
          body: `${label}: ${draft.title}. Review it and post it from the project’s header.`,
          entity: 'PROJECT',
          entityId: rule.projectId,
          actionUrl: `/projects/${rule.projectId}`,
        },
      });
    }

    return {
      succeeded: true,
      message: `AI drafted “${draft.title}” (${label}) for review.`,
      after: row.id,
    };
  }

  private async createTask(
    config: Record<string, unknown>,
    source: TextSource | null,
    rule: RunnableRule,
    event: AutomationEvent,
    at: Date,
  ): Promise<ActionOutcome> {
    const values = await this.textValues(source, rule, event, at);
    const title = renderAutomationText(String(config['title'] ?? ''), values)
      .trim()
      .slice(0, TASK_TITLE_MAX_LENGTH);

    if (!title) return { succeeded: false, message: 'The new task has no name.' };

    const project = await this.prisma.project.findFirst({
      where: { id: rule.projectId, archivedAt: null },
      select: { id: true, sections: { orderBy: { position: 'asc' }, select: { id: true } } },
    });
    if (!project) return { succeeded: false, message: 'This project is archived.' };

    const requested = typeof config['sectionId'] === 'string' ? config['sectionId'] : '';
    const section = requested
      ? project.sections.find((row) => row.id === requested)
      : project.sections[0];

    if (requested && !section) {
      return { succeeded: false, message: 'That section is no longer in this project.' };
    }

    const sectionId = section?.id ?? null;
    const notes: string[] = [];

    let assigneeId: string | null = null;
    if (typeof config['assigneeId'] === 'string' && config['assigneeId'] !== '') {
      const member = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: rule.workspaceId, userId: config['assigneeId'] },
        select: { userId: true },
      });
      if (!member) {
        notes.push('The assignee is no longer in this workspace, so the task is unassigned.');
      } else if (
        !(await isAssignable(this.prisma, rule.workspaceId, [project.id], member.userId))
      ) {
        notes.push('The assignee is not a member of this project, so the task is unassigned.');
      } else {
        assigneeId = member.userId;
      }
    }

    const days = config['dueInDays'];
    const dueDate =
      typeof days === 'number' && Number.isInteger(days) && days >= 0
        ? toCalendarDate(new Date(at.getTime() + days * 86_400_000))
        : null;

    const describedAs =
      typeof config['description'] === 'string'
        ? renderAutomationText(config['description'], values).trim()
        : '';

    const createdById =
      event.actorId ?? source?.createdById ?? rule.createdById ?? (await this.ownerOf(rule));
    if (!createdById) {
      return { succeeded: false, message: 'Nobody could be credited with the new task.' };
    }

    const siblings = await this.prisma.task.findMany({
      where: {
        workspaceId: rule.workspaceId,
        archivedAt: null,
        parentTaskId: null,
        parentTicketId: null,
        ...(sectionId ? { sectionId } : { sectionId: null, projectId: project.id }),
      },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });

    const created = await this.prisma.task.create({
      data: {
        workspaceId: rule.workspaceId,
        projectId: project.id,
        sectionId,
        title,
        description: describedAs ? plainTextToHtml(describedAs) : null,
        assigneeId,
        dueDate,
        position: appendPosition(siblings),
        createdById,
      },
    });

    if (assigneeId) {
      await this.prisma.follower.createMany({
        data: [
          { workspaceId: rule.workspaceId, userId: assigneeId, taskId: created.id, ticketId: null },
        ],
        skipDuplicates: true,
      });
    }

    return {
      succeeded: true,
      after: created.id,
      ...(notes.length ? { message: notes.join(' ') } : {}),
      // A new task in this project, so the rules that greet one hear of it.
      events: [
        this.follow(
          rule,
          event,
          AutomationTrigger.TASK_CREATED,
          created.id,
          undefined,
          {
            title: created.title,
            sectionId: created.sectionId,
            assigneeId: created.assigneeId,
            dueDate: created.dueDate?.toISOString() ?? null,
          },
          project.id,
        ),
      ],
    };
  }

  /** The workspace's owner, for a rule nobody can be credited with. */
  private async ownerOf(rule: RunnableRule): Promise<string | null> {
    const owner = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: rule.workspaceId, role: WorkspaceRole.OWNER },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  /**
   * The status that completes or reopens a task in its project.
   *
   * The project's own statuses when it has them, the workspace's otherwise, as
   * the board resolves them: the first COMPLETED one to finish a task, and the
   * first not-started — or failing that, active — one to reopen it. With no
   * definitions at all, the legacy Done and To do.
   */
  private async completionStatus(
    workspaceId: string,
    projectId: string | null,
    complete: boolean,
  ): Promise<string> {
    const select = { id: true, category: true } as const;
    const own = projectId
      ? await this.prisma.statusDefinition.findMany({
          where: { workspaceId, projectId, isArchived: false },
          orderBy: { position: 'asc' },
          select,
        })
      : [];
    const set =
      own.length > 0
        ? own
        : await this.prisma.statusDefinition.findMany({
            where: { workspaceId, projectId: null, isArchived: false },
            orderBy: { position: 'asc' },
            select,
          });

    const wanted = complete
      ? set.find((row) => row.category === StatusCategory.COMPLETED)
      : (set.find((row) => row.category === StatusCategory.NOT_STARTED) ??
        set.find((row) => row.category === StatusCategory.ACTIVE));

    return wanted?.id ?? (complete ? TaskStatus.DONE : TaskStatus.TODO);
  }

  /**
   * What the variables in a rule's text stand for, on this run.
   *
   * Names are looked up now rather than stored, so a renamed assignee reads as
   * they are called today. Dates print as people read them; an absent one is
   * empty rather than the placeholder.
   */
  private async textValues(
    task: TextSource | null,
    rule: RunnableRule,
    event: AutomationEvent,
    at: Date,
  ): Promise<Partial<Record<AutomationTextVariable, string>>> {
    const names = await this.peopleNames(
      [task?.assigneeId, event.actorId].filter((id): id is string => Boolean(id)),
    );
    const project = await this.prisma.project.findUnique({
      where: { id: rule.projectId },
      select: { name: true },
    });

    /*
     * "Today" is somebody's today: the zone a clock rule was set in, else the
     * browser of whoever pressed "Run rule", else their profile's, else UTC. A
     * run at 3am in Manila is already tomorrow there, and the comment should
     * say so.
     */
    const ruleZone = (rule.triggerConfig as Record<string, unknown> | null)?.['timezone'];
    const configured = isTimeZone(ruleZone) ? ruleZone : event.after?.['timezone'];
    const actorZone = event.actorId
      ? (
          await this.prisma.user.findUnique({
            where: { id: event.actorId },
            select: { timezone: true },
          })
        )?.timezone
      : undefined;
    const zone = isTimeZone(configured) ? configured : isTimeZone(actorZone) ? actorZone : 'UTC';
    const today = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: zone,
    }).format(at);

    return {
      'task.name': task?.title ?? '',
      'task.assignee': task?.assigneeId ? (names.get(task.assigneeId) ?? '') : '',
      'task.due_date': task?.dueDate ? DAY_FORMAT.format(task.dueDate) : '',
      'task.start_date': task?.startDate ? DAY_FORMAT.format(task.startDate) : '',
      'project.name': project?.name ?? '',
      triggered_by: event.actorId ? (names.get(event.actorId) ?? '') : '',
      today,
    };
  }

  /**
   * The status a task keeps when it changes project.
   *
   * Statuses can be a project's own, and a task arriving with another
   * project's definition would show a status its new board never lists. The
   * target's set is resolved the way the metadata resolves it — its own when
   * it has one, the workspace default set when it does not — and the task
   * keeps its definition when that set holds it, takes the same-named one
   * when it does not, and otherwise the nearest by category or the set's
   * default. A task carrying only the legacy enum has nothing to remap.
   */
  private async statusInProject(
    workspaceId: string,
    projectId: string,
    statusDefinitionId: string | null,
  ): Promise<{ statusDefinitionId?: string }> {
    if (!statusDefinitionId) return {};

    const select = { id: true, slug: true, category: true, isDefault: true } as const;

    const own = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, projectId, isArchived: false },
      orderBy: { position: 'asc' },
      select,
    });
    const set =
      own.length > 0
        ? own
        : await this.prisma.statusDefinition.findMany({
            where: { workspaceId, projectId: null, isArchived: false },
            orderBy: { position: 'asc' },
            select,
          });

    if (set.some((row) => row.id === statusDefinitionId)) return {};

    const current = await this.prisma.statusDefinition.findUnique({
      where: { id: statusDefinitionId },
      select: { slug: true, category: true },
    });

    const match =
      set.find((row) => row.slug === current?.slug) ??
      set.find((row) => row.category === current?.category) ??
      set.find((row) => row.isDefault) ??
      set[0];

    return match ? { statusDefinitionId: match.id } : {};
  }

  /**
   * The story a person's field edit leaves, for a rule's.
   *
   * `CustomFieldsService.announce` is not reachable from the worker, so the
   * same shape is written here by hand: the feed reads one `FIELD_CHANGED`
   * whoever made the change, with the labels resolved now rather than by id
   * later. Collaborators are told when the project asked for it; nobody is
   * left out, since a rule is not a person who already knows.
   */
  private async recordFieldChange(
    rule: { id: string; workspaceId: string },
    event: AutomationEvent,
    task: { id: string; title: string },
    field: {
      id: string;
      name: string;
      type: string;
      settings: unknown;
      options: { id: string; label: string }[];
      notifyOnChange: boolean;
    },
    before: TaskCustomFieldValueDto | null,
    after: TaskCustomFieldValueDto | null,
  ): Promise<void> {
    const labelled = {
      type: field.type as CustomFieldType,
      options: field.options,
      settings: field.settings as Record<string, unknown> | null,
    };
    const names =
      field.type === 'PEOPLE'
        ? await this.peopleNames([...(before?.userIds ?? []), ...(after?.userIds ?? [])])
        : new Map<string, string>();
    const from = labelValue(labelled, before, names);
    const to = labelValue(labelled, after, names);

    const metadata: CustomFieldStoryMetadata = {
      fieldId: field.id,
      fieldName: field.name,
      type: field.type,
      before: from && from.label !== null ? from : null,
      after: to && to.label !== null ? to : null,
      source: 'AUTOMATION',
    };
    if (metadata.before === null && metadata.after === null) return;

    const what =
      metadata.after === null
        ? `cleared ${field.name}`
        : metadata.before === null
          ? `set ${field.name} to ${metadata.after.label}`
          : `changed ${field.name} from ${metadata.before.label} to ${metadata.after.label}`;

    await this.prisma.activityLog.create({
      data: {
        workspaceId: rule.workspaceId,
        actorId: event.actorId ?? null,
        action: ActivityAction.FIELD_CHANGED,
        entity: ActivityEntity.TASK,
        entityId: task.id,
        summary: `An automation ${what}`,
        metadata: { ...metadata, ruleId: rule.id } as unknown as Prisma.InputJsonValue,
      },
    });

    if (!field.notifyOnChange) return;

    const followers = await this.prisma.follower.findMany({
      where: { taskId: task.id },
      select: { userId: true },
    });
    if (followers.length === 0) return;

    const label = `“${task.title}”`;
    await this.prisma.notification.createMany({
      data: followers.map(({ userId }) => ({
        userId,
        workspaceId: rule.workspaceId,
        type: NotificationType.FIELD_CHANGED,
        title:
          metadata.after === null
            ? `An automation cleared ${field.name} on ${label}`
            : `An automation changed ${field.name} to ${metadata.after.label} on ${label}`,
        body:
          metadata.before !== null && metadata.after !== null
            ? `${metadata.before.label} → ${metadata.after.label}`
            : metadata.before !== null
              ? `was ${metadata.before.label}`
              : null,
        entity: 'TASK',
        entityId: task.id,
        actionUrl: `/my-tasks?task=${task.id}`,
      })),
    });
  }

  private async peopleNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  /**
   * The same stories a person's edit writes, so the task panel reads "moved
   * to In Review" whether a hand or a rule did it. Written through Prisma like
   * everything else here; the actor is the person whose action the rule
   * followed from, which is what the audit trail already says of it.
   */
  private async recordStories(
    before: Task,
    updated: Task,
    rule: { id: string; workspaceId: string },
    event: AutomationEvent,
  ): Promise<void> {
    const ids = [before.assigneeId, updated.assigneeId].filter((id): id is string => !!id);
    const sectionIds = [before.sectionId, updated.sectionId].filter((id): id is string => !!id);
    const teamIds = [before.teamId, updated.teamId].filter((id): id is string => !!id);

    const [users, sections, teams] = await Promise.all([
      ids.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      sectionIds.length > 0
        ? this.prisma.section.findMany({
            where: { id: { in: sectionIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      teamIds.length > 0
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const userRef = (id: string | null) => {
      const user = users.find((row) => row.id === id);
      return user ? { id: user.id, label: user.name } : null;
    };
    const sectionRef = (id: string | null) => {
      const section = sections.find((row) => row.id === id);
      return section ? { id: section.id, label: section.name } : null;
    };
    const teamRef = (id: string | null) => {
      if (!id) return null;
      const team = teams.find((row) => row.id === id);
      return { id, label: team?.name ?? 'a team that was removed' };
    };

    const stories = diffItemStories(
      snapshotFromTask(before, {
        assignee: userRef(before.assigneeId),
        section: sectionRef(before.sectionId),
        team: teamRef(before.teamId),
      }),
      snapshotFromTask(updated, {
        assignee: userRef(updated.assigneeId),
        section: sectionRef(updated.sectionId),
        team: teamRef(updated.teamId),
      }),
      'task',
    );
    if (stories.length === 0) return;

    try {
      await this.prisma.activityLog.createMany({
        data: stories.map((story) => ({
          workspaceId: rule.workspaceId,
          actorId: event.actorId ?? null,
          action: story.action,
          entity: 'TASK' as const,
          entityId: updated.id,
          summary: story.summary.slice(0, 500),
          metadata: story.metadata as unknown as Prisma.InputJsonValue,
        })),
      });
    } catch (error) {
      this.logger.error({ err: error, ruleId: rule.id }, 'Failed to write automation stories');
    }
  }

  /**
   * A domain event for a change one of this rule's actions just made, shaped
   * as the same change made by a person is — the rules listening for it cannot
   * tell the difference, and must not have to.
   *
   * Tagged with the rule, so the self-retrigger block can refuse it; one hop
   * deeper, so the depth limit can bound the chain; and on the same correlation
   * id, so the whole chain reads as one story in the history. The actor is
   * carried through rather than dropped: the write is a consequence of what
   * that person did, which is exactly what the activity feed already says of
   * it.
   */
  private follow(
    rule: { id: string; workspaceId: string },
    event: AutomationEvent,
    trigger: AutomationTrigger,
    entityId: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    /** The project to raise it in, when the write moved the task out of this one. */
    projectId?: string,
  ): AutomationEvent {
    return {
      eventId: randomUUID(),
      workspaceId: rule.workspaceId,
      projectId: projectId ?? event.projectId,
      trigger,
      entityType: 'TASK',
      entityId,
      actorId: event.actorId ?? null,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      correlationId: event.correlationId,
      chainId: chainOf(event),
      depth: event.depth + 1,
      causedByRuleId: rule.id,
    };
  }

  private async finish(
    executionId: string,
    status: AutomationExecutionStatus,
    started: number,
    extra: { skippedReason?: string; error?: string },
  ): Promise<void> {
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        skippedReason: extra.skippedReason ?? null,
        error: extra.error ?? null,
      },
    });
  }

  private async bumpRule(
    ruleId: string,
    status: AutomationExecutionStatus,
    failed = false,
  ): Promise<void> {
    await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: status,
        runCount: { increment: 1 },
        ...(failed ? { failureCount: { increment: 1 } } : {}),
      },
    });
  }

  /**
   * A stopped chain is recorded, so a silent halt is never a mystery.
   *
   * Against a live rule listening for this trigger: the execution history is
   * read per rule, and pinning the skip to a draft or an archived one that had
   * nothing to do with the event sends somebody to read the wrong rule.
   */
  private async recordSkipped(event: AutomationEvent, reason: string): Promise<void> {
    const rule = await this.prisma.automationRule.findFirst({
      where: {
        projectId: event.projectId,
        status: AutomationRuleStatus.ACTIVE,
        publishedVersion: { is: { triggerType: event.trigger } },
      },
      select: { id: true, workspaceId: true },
    });

    if (!rule) return;

    try {
      await this.prisma.automationExecution.create({
        data: {
          workspaceId: rule.workspaceId,
          projectId: event.projectId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.SKIPPED,
          triggerType: event.trigger,
          entityType: event.entityType,
          entityId: event.entityId,
          correlationId: event.correlationId,
          chainId: chainOf(event),
          // Keyed like a run, so a retried job does not record the stop twice.
          idempotencyKey: runKey(event),
          depth: event.depth,
          skippedReason: reason,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Ticket rules
  // -------------------------------------------------------------------------

  /**
   * A rule set off by a ticket. The same plan, log and history as a task's,
   * over the ticket: "Ticket is…" conditions, and the short list of actions a
   * ticket takes (contracts' `TICKET_RULE_ACTIONS`). The validator refuses the
   * rest at publish; anything that slips by fails here rather than guessing.
   */
  private async runTicketRule(
    rule: RunnableRule,
    event: AutomationEvent,
    executionId: string,
    started: number,
  ): Promise<RuleRun> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: event.entityId, workspaceId: rule.workspaceId, archivedAt: null },
    });
    if (!ticket) {
      await this.finish(executionId, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason: 'The ticket no longer exists.',
      });
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    // Judged on the ticket as the event found it.
    const facts = {
      type: ticket.type as string,
      priority: ticket.priority as string,
      severity: ticket.severity as string,
      status: ticket.status as string,
      assigneeId: ticket.assigneeId,
    };
    const plan = await this.plan(
      rule.nodes,
      (node) =>
        // Grouped like a task's — the fallback included — with each
        // comparison about the ticket's own fields.
        evaluateCondition(
          node.configuration,
          (comparison) =>
            isTicketConditionField(comparison['field']) && ticketConditionHolds(comparison, facts),
        ),
      event.resumeFromNodeId,
    );
    if (plan.skippedBy) {
      await this.finish(executionId, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason:
          plan.skippedBy === 'the rule changed while it was waiting'
            ? 'The rule changed while this run was waiting.'
            : `Condition not met: ${plan.skippedBy}.`,
      });
      await this.bumpRule(rule.id, AutomationExecutionStatus.SKIPPED);
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    const live: TicketRow = { ...ticket };
    const steps = await this.perform(executionId, event, plan.actions, (node) =>
      this.runTicketAction(node, live, rule, event, new Date(started)),
    );
    const { failures, events, emails } = steps;

    if (await this.stoppedByChain(rule, executionId, steps, started)) {
      return { ran: false, events: [], webhooks: [], emails: [] };
    }

    const status = runStatus(steps);
    await this.scheduleDelays(rule, event, plan.delays, executionId, started);
    await this.finish(executionId, status, started, cutNote(steps));
    await this.bumpRule(rule.id, status, failures > 0 || steps.cut > 0);

    if (steps.attempted > failures) {
      // The ticket's history says a rule did it, as a task's does.
      await this.prisma.activityLog.create({
        data: {
          workspaceId: rule.workspaceId,
          actorId: event.actorId ?? null,
          action: ActivityAction.UPDATED,
          entity: ActivityEntity.TICKET,
          entityId: ticket.id,
          projectId: ticket.projectId,
          summary: `Automation "${rule.name}" updated ${ticket.key}`,
          metadata: { ruleId: rule.id, executionId, actions: steps.attempted, failures },
        },
      });
      for (const projectId of new Set([event.projectId, live.projectId ?? event.projectId])) {
        await this.relay.toProject(projectId, ServerEvent.WORK_ITEM_UPDATED, {
          workspaceId: rule.workspaceId,
          projectId,
          occurredAt: new Date().toISOString(),
          source: 'automation',
        });
      }
      // The Tickets page lists the whole workspace and sits in no project
      // room, so it is told too — that the list changed, and nothing else.
      await this.relay.toWorkspace(rule.workspaceId, ServerEvent.TICKET_UPDATED, {
        workspaceId: rule.workspaceId,
        source: 'automation',
      });
    }

    return { ran: true, events, webhooks: [], emails };
  }

  /** One action on a ticket. `ticket` is the live row, kept current across actions. */
  private async runTicketAction(
    node: AutomationNode,
    ticket: TicketRow,
    rule: RunnableRule,
    event: AutomationEvent,
    at: Date,
  ): Promise<ActionOutcome> {
    const config = (node.configuration ?? {}) as Record<string, unknown>;
    const write = async (data: Prisma.TicketUncheckedUpdateInput) => {
      const updated = await this.prisma.ticket.update({ where: { id: ticket.id }, data });
      Object.assign(ticket, updated);
    };
    const source: TextSource = {
      title: `${ticket.key} ${ticket.title}`,
      assigneeId: ticket.assigneeId,
      dueDate: ticket.dueDate,
      createdById: ticket.reporterId,
    };
    const link = `/tickets?ticket=${ticket.key}`;

    switch (node.subtype) {
      case AutomationAction.SET_TICKET_STATUS: {
        const status = String(config['status'] ?? '');
        if (!(TICKET_STATUSES as readonly string[]).includes(status)) {
          return { succeeded: false, message: 'Choose a ticket status.' };
        }
        const before = ticket.status as string;
        if (before === status) {
          return { succeeded: true, message: 'The ticket already has that status.' };
        }
        await write({
          status: status as TicketRow['status'],
          ...ticketLifecycle(status, ticket.resolvedAt, ticket.closedAt, at),
        });
        // Raised for the next rule, as a person's change of status is.
        return {
          succeeded: true,
          before,
          after: status,
          events: [
            this.followTicket(
              rule,
              event,
              AutomationTrigger.TICKET_STATUS_CHANGED,
              ticket.id,
              { status: before },
              { status },
            ),
          ],
        };
      }

      case AutomationAction.SET_TICKET_PRIORITY: {
        const priority = String(config['priority'] ?? '');
        if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) {
          return { succeeded: false, message: 'Choose a ticket priority.' };
        }
        const before = ticket.priority as string;
        if (before !== priority) await write({ priority: priority as TicketRow['priority'] });
        return { succeeded: true, before, after: priority };
      }

      case AutomationAction.ASSIGN_USER: {
        const userId = String(config['userId'] ?? config['assigneeId'] ?? '');
        const member = await this.prisma.workspaceMember.findFirst({
          where: { workspaceId: rule.workspaceId, userId },
          select: { id: true },
        });
        if (!member) {
          return { succeeded: false, message: 'That person is no longer in this workspace.' };
        }
        if (
          !(await isAssignable(
            this.prisma,
            rule.workspaceId,
            [ticket.projectId, rule.projectId],
            userId,
          ))
        ) {
          return { succeeded: false, message: NOT_A_PROJECT_MEMBER };
        }
        const before = ticket.assigneeId;
        await write({ assigneeId: userId });
        // An assignee follows what they are given, as on a task.
        await this.prisma.follower.createMany({
          data: [{ workspaceId: rule.workspaceId, userId, taskId: null, ticketId: ticket.id }],
          skipDuplicates: true,
        });
        return { succeeded: true, before, after: userId };
      }

      case AutomationAction.UNASSIGN_USER: {
        const before = ticket.assigneeId;
        await write({ assigneeId: null });
        return { succeeded: true, before, after: null };
      }

      case AutomationAction.MOVE_TO_SECTION: {
        const sectionId = String(config['sectionId'] ?? '');
        const section = await this.prisma.section.findFirst({
          where: { id: sectionId, projectId: rule.projectId },
          select: { id: true },
        });
        if (!section) return { succeeded: false, message: 'That section is not in this project.' };
        const before = ticket.sectionId;
        if (before !== sectionId) {
          // Last in its new column, as a card dragged there lands.
          const last = await this.prisma.ticket.findFirst({
            where: { sectionId, archivedAt: null },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          await write({ sectionId, position: (last?.position ?? 0) + POSITION_STEP });
        }
        return { succeeded: true, before, after: sectionId };
      }

      case AutomationAction.SET_DUE_DATE: {
        const dueDate = dueDateFor(config, at);
        const before = ticket.dueDate?.toISOString() ?? null;
        await write({ dueDate });
        return { succeeded: true, before, after: dueDate.toISOString() };
      }

      case AutomationAction.CLEAR_DUE_DATE: {
        const before = ticket.dueDate?.toISOString() ?? null;
        await write({ dueDate: null });
        return { succeeded: true, before, after: null };
      }

      case AutomationAction.ADD_COMMENT: {
        const body = renderAutomationText(
          String(config['body'] ?? ''),
          await this.textValues(source, rule, event, at),
        ).trim();
        if (!body) return { succeeded: false, message: 'The comment is empty.' };
        const authorId =
          event.actorId ?? ticket.reporterId ?? rule.createdById ?? (await this.ownerOf(rule));
        if (!authorId) return { succeeded: false, message: 'Nobody to write the comment as.' };
        await this.prisma.comment.create({
          data: { workspaceId: rule.workspaceId, authorId, body, ticketId: ticket.id },
        });
        return { succeeded: true, after: body.slice(0, 100) };
      }

      case AutomationAction.SEND_IN_APP_NOTIFICATION: {
        const userId = String(config['userId'] ?? ticket.assigneeId ?? '');
        if (!userId) return { succeeded: false, message: 'Nobody to notify.' };
        await this.prisma.notification.create({
          data: {
            userId,
            workspaceId: rule.workspaceId,
            type: NotificationType.TICKET_UPDATED,
            title: String(config['title'] ?? `Automation updated ${ticket.key}: ${ticket.title}`),
            body: config['body'] ? String(config['body']) : null,
            entity: 'TICKET',
            entityId: ticket.id,
            actionUrl: link,
          },
        });
        return { succeeded: true, after: userId };
      }

      case AutomationAction.SEND_EMAIL: {
        const values = await this.textValues(source, rule, event, at);
        const subject = renderAutomationText(String(config['subject'] ?? ''), values)
          .trim()
          .slice(0, AUTOMATION_EMAIL_SUBJECT_MAX);
        if (!subject) return { succeeded: false, message: 'The email has no subject.' };
        const body = renderAutomationText(String(config['body'] ?? ''), values).trim();
        const who = emailRecipientsOf(config);
        if (who.length === 0) return { succeeded: false, message: 'Nobody is chosen to email.' };

        // The ticket's people: whoever it is assigned to, its followers, and
        // whoever reported it.
        const ids = new Set<string>();
        if (who.includes(AutomationEmailRecipient.ASSIGNEE) && ticket.assigneeId) {
          ids.add(ticket.assigneeId);
        }
        if (who.includes(AutomationEmailRecipient.CREATOR) && ticket.reporterId) {
          ids.add(ticket.reporterId);
        }
        if (who.includes(AutomationEmailRecipient.COLLABORATORS)) {
          const followers = await this.prisma.follower.findMany({
            where: { ticketId: ticket.id },
            select: { userId: true },
          });
          for (const follower of followers) ids.add(follower.userId);
        }
        const members = await this.prisma.workspaceMember.findMany({
          where: { workspaceId: rule.workspaceId, userId: { in: [...ids] } },
          select: { user: { select: { email: true } } },
          take: MAX_EMAIL_RECIPIENTS,
        });
        if (members.length === 0) {
          return {
            succeeded: true,
            message: 'Nobody to email: the ticket has none of those people.',
          };
        }
        return {
          succeeded: true,
          message: `Queued an email to ${members.length} ${members.length === 1 ? 'person' : 'people'}`,
          after: { recipients: members.length },
          emails: members.map((member) => ({
            to: member.user.email,
            subject,
            body,
            taskId: ticket.id,
            taskTitle: `${ticket.key} ${ticket.title}`,
            path: link,
            ruleName: rule.name,
          })),
        };
      }

      case AutomationAction.ADD_REMOVE_COLLABORATORS: {
        const people = (key: string): string[] =>
          Array.isArray(config[key])
            ? [
                ...new Set(
                  (config[key] as unknown[]).filter(
                    (value): value is string => typeof value === 'string' && value !== '',
                  ),
                ),
              ]
            : [];
        const add = people('add');
        const remove = people('remove').filter((id) => !add.includes(id));
        if (add.length === 0 && remove.length === 0) {
          return { succeeded: false, message: 'Nobody was chosen to add or remove.' };
        }
        const members = add.length
          ? await this.prisma.workspaceMember.findMany({
              where: { workspaceId: rule.workspaceId, userId: { in: add } },
              select: { userId: true },
            })
          : [];
        if (members.length) {
          await this.prisma.follower.createMany({
            data: members.map((member) => ({
              workspaceId: rule.workspaceId,
              userId: member.userId,
              taskId: null,
              ticketId: ticket.id,
            })),
            skipDuplicates: true,
          });
        }
        if (remove.length) {
          await this.prisma.follower.deleteMany({
            where: { ticketId: ticket.id, userId: { in: remove } },
          });
        }
        return {
          succeeded: true,
          after: { added: members.map((member) => member.userId), removed: remove },
        };
      }

      // "Investigate {{task.name}}": a task in this project, named from the ticket.
      case AutomationAction.CREATE_TASK:
        return this.createTask(config, source, rule, event, at);

      default:
        return { succeeded: false, message: 'A ticket rule cannot do this — it works on tasks.' };
    }
  }

  /** A follow-up event about a ticket, for the next rule in the chain. */
  private followTicket(
    rule: { id: string; workspaceId: string },
    event: AutomationEvent,
    trigger: AutomationTrigger,
    entityId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): AutomationEvent {
    return { ...this.follow(rule, event, trigger, entityId, before, after), entityType: 'TICKET' };
  }

  // -------------------------------------------------------------------------
  // Wait steps
  // -------------------------------------------------------------------------

  /**
   * The Wait steps a run reached: each becomes a row the clock picks up when
   * its time has passed, and a line in this run's log saying until when.
   */
  private async scheduleDelays(
    rule: RunnableRule,
    event: AutomationEvent,
    delays: readonly AutomationNode[],
    executionId: string,
    started: number,
  ): Promise<void> {
    for (const node of delays) {
      const ms = delayMs((node.configuration ?? {}) as Record<string, unknown>);
      if (ms === null) {
        await this.prisma.automationExecutionLog.create({
          data: {
            executionId,
            nodeId: node.id,
            nodeType: node.nodeType,
            subtype: node.subtype,
            succeeded: false,
            message: 'The wait has no length, so nothing after it ran.',
          },
        });
        continue;
      }
      const runAt = new Date(started + ms);
      // The event as it started, minus what made this run a resumption.
      const { resumeFromNodeId: _resumed, ...original } = event;
      await this.prisma.automationDelayedRun.create({
        data: {
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
          ruleId: rule.id,
          nodeId: node.id,
          ruleVersionId: rule.versionId,
          runAt,
          event: original as unknown as Prisma.InputJsonValue,
        },
      });
      await this.prisma.automationExecutionLog.create({
        data: {
          executionId,
          nodeId: node.id,
          nodeType: node.nodeType,
          subtype: node.subtype,
          succeeded: true,
          message: `${describeDelay((node.configuration ?? {}) as Record<string, unknown>)} — continues at ${runAt.toISOString()}`,
          afterValue: { runAt: runAt.toISOString() } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

/**
 * How a run that got as far as its actions ended.
 *
 * Every step it ran failed: FAILED. Some failed, or some were cut off by a cap:
 * PARTIALLY_FAILED — a run that did less than its rule says is not COMPLETED,
 * whatever the steps it did run made of it. A run with no action steps at all
 * (a Wait and nothing before it) has not failed at anything.
 */
function runStatus(steps: StepsResult): AutomationExecutionStatus {
  if (steps.attempted > 0 && steps.failures === steps.attempted) {
    return AutomationExecutionStatus.FAILED;
  }
  if (steps.failures > 0 || steps.cut > 0) return AutomationExecutionStatus.PARTIALLY_FAILED;
  return AutomationExecutionStatus.COMPLETED;
}

/** The run's own line about steps a cap cut off — each also has a log row. */
function cutNote(steps: StepsResult): { error?: string } {
  if (steps.cut === 0) return {};

  const count = steps.cut === 1 ? '1 step was' : `${steps.cut} steps were`;
  return { error: `${count} not run: ${steps.cutReason ?? 'a limit was reached'}.` };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Maps a configured value onto the column its field type uses. */
/**
 * A stored value, with anything the rule computes worked out.
 *
 * `at` is the execution's own start rather than "now", so every action in one
 * run stamps the same instant. Two actions computing their own `now` would
 * differ by however long the first took, and a later question like "did these
 * happen together?" would get a subtly wrong answer that nothing would explain.
 *
 * An unknown token is left alone rather than guessed at: it falls through to the
 * coercion below, which turns it into `Invalid Date` and fails the action
 * loudly. Silently substituting today's date would write a plausible wrong
 * answer, which is worse than a visible failure.
 */
/**
 * When a subtask is due, as the calendar date the column holds — or null.
 *
 * Relative to when this execution began rather than to `new Date()`, so every
 * subtask in one run, and every action beside them, agrees on what "today" is.
 * The validator refuses a date that is not one, so the guards here are for a
 * rule that reached the runner some other way; they create the subtask undated
 * rather than hand Prisma an invalid date.
 */
function subtaskDueDate(entry: SubtaskEntry, at: Date): Date | null {
  if (isCalendarDate(entry.dueDate)) return toCalendarDate(entry.dueDate);

  if (entry.dueInDays !== undefined && Number.isInteger(entry.dueInDays) && entry.dueInDays >= 0) {
    const due = new Date(at);
    due.setUTCDate(due.getUTCDate() + entry.dueInDays);
    return toCalendarDate(due);
  }

  if (isWeekday(entry.dueWeekdayNextWeek)) {
    return toCalendarDate(dayNextWeek(at, entry.dueWeekdayNextWeek));
  }

  return null;
}

/**
 * Where "Set due date" lands: that weekday of next week when the step says so,
 * otherwise its count of days from `from`.
 */
function dueDateFor(config: Record<string, unknown>, from: Date): Date {
  const weekday = config['weekdayNextWeek'];
  if (isWeekday(weekday)) return toCalendarDate(dayNextWeek(from, weekday));

  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + Number(config['daysFromNow'] ?? 0));
  return toCalendarDate(due);
}

function resolveValue(value: unknown, at: Date): unknown {
  if (!isTokenValue(value)) return value;

  switch (value.token) {
    case AUTOMATION_VALUE_TOKEN.TRIGGER_DATE:
      return at.toISOString();
    default:
      return value;
  }
}

/**
 * The inverse of `customFieldValue` below: which of the typed columns holds the
 * value, normalised for the comparisons `conditionHolds` makes.
 *
 * The column says the type, so the field definition is never needed. Dates go
 * out as ISO strings — the configured side is a string and the date operators
 * parse both — and a single option or person unwraps to its id so `IS` compares
 * id to id. A list with several entries comes back as the list, which
 * `conditionHolds` compares by membership: "is set to X" against a set asks
 * whether X is among what is held.
 */
function customFieldActual(row: TaskCustomFieldValue | undefined): unknown {
  if (!row) return null;

  if (row.textValue !== null) return row.textValue;
  if (row.numberValue !== null) return Number(row.numberValue);
  if (row.dateValue !== null) return row.dateValue.toISOString();
  if (row.booleanValue !== null) return row.booleanValue;
  if (row.optionIds.length > 0) {
    return row.optionIds.length === 1 ? row.optionIds[0] : row.optionIds;
  }
  if (row.userIds.length > 0) {
    return row.userIds.length === 1 ? row.userIds[0] : row.userIds;
  }

  return null;
}

/**
 * The columns a rule can write, as an event's `before` and `after` carry them.
 *
 * Dates go out as ISO strings, the shape every other publisher uses and the
 * one a condition reading the event can compare.
 */
function snapshot(task: Task): Record<string, unknown> {
  return {
    sectionId: task.sectionId,
    status: task.status,
    statusDefinitionId: task.statusDefinitionId,
    priority: task.priority,
    priorityDefinitionId: task.priorityDefinitionId,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate?.toISOString() ?? null,
    startDate: task.startDate?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
    title: task.title,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

/** Column equality, with dates compared as instants rather than by reference. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  return a === b;
}

/** Two value DTOs, compared by content. The mapper builds them key for key. */
function sameValue(a: TaskCustomFieldValueDto | null, b: TaskCustomFieldValueDto | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function customFieldValue(type: string, value: unknown): Record<string, unknown> {
  const blank = {
    textValue: null,
    numberValue: null,
    dateValue: null,
    booleanValue: null,
    optionIds: [] as string[],
    userIds: [] as string[],
  };

  switch (type) {
    case 'NUMBER':
    case 'RATING':
      return { ...blank, numberValue: Number(value) };
    case 'DATE':
      return { ...blank, dateValue: new Date(String(value)) };
    case 'CHECKBOX':
      return { ...blank, booleanValue: Boolean(value) };
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return { ...blank, optionIds: Array.isArray(value) ? value.map(String) : [String(value)] };
    case 'PEOPLE':
      return { ...blank, userIds: Array.isArray(value) ? value.map(String) : [String(value)] };
    default:
      return { ...blank, textValue: String(value) };
  }
}

export type { AutomationTrigger };

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
  isFallbackBranch,
  MAX_ACTIONS_PER_EXECUTION,
  MAX_AUTOMATION_DEPTH,
  AUTOMATION_VALUE_TOKEN,
  isTokenValue,
  NotificationType,
  POSITION_STEP,
  webhookExtraFields,
  ServerEvent,
  isCalendarDate,
  subtaskEntries,
  toFilterOperator,
  isDirectOperator,
  AutomationTrigger,
  isComputedFieldType,
  type CustomFieldStoryMetadata,
  type CustomFieldType,
  type SubtaskEntry,
} from '@coretask/contracts';
import type { TaskCustomFieldValue as TaskCustomFieldValueDto } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import {
  TaskStatus,
  type AutomationNode,
  type Prisma,
  type Task,
  type TaskCustomFieldValue,
} from '@prisma/client';

import { appendPosition } from '../../common/utils/position.util';
import { toCalendarDate } from '../../common/utils/schedule.util';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeRelayPublisher } from '../../websocket/realtime-relay.publisher';
import { diffItemStories, snapshotFromTask } from '../activity-logs/item-stories';
import { toValueDto } from '../custom-fields/custom-field-value.mapper';
import { labelValue } from '../custom-fields/lib/value-labels';

import { priorityData, readActionId, statusData } from './action-config';
import type { RuleWebhookRequest } from '../../jobs/queue-names';

import type { AutomationEvent } from './automation-event.publisher';
import { directComparison } from './condition-comparison';
import { fieldChangeTriggers } from './task-field-triggers';

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
}

/** What `handle` reports back: counts for the log, events for the queue. */
export interface AutomationRunResult {
  executed: number;
  skipped: number;
  /** Webhook requests from "Send a webhook" actions, handed back for the same reason as `events`. */
  webhooks: RuleWebhookRequest[];
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
type EvaluableTask = Task & { customFieldValues?: TaskCustomFieldValue[] };

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly relay: RealtimeRelayPublisher,
  ) {}

  /**
   * Finds the rules matching an event and runs each one.
   *
   * Returns how many executed, which is what the processor logs, and the
   * events their actions raised, which is what the processor publishes so the
   * next rule in a chain gets its turn.
   */
  async handle(event: AutomationEvent): Promise<AutomationRunResult> {
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
      return { executed: 0, skipped: 1, events: [], webhooks: [] };
    }

    const rules = await this.prisma.automationRule.findMany({
      where: {
        projectId: event.projectId,
        status: AutomationRuleStatus.ACTIVE,
        triggerType: event.trigger,
      },
      include: { nodes: { orderBy: { position: 'asc' } } },
      // Oldest first, ids as the tie-break: two rules writing the same column
      // on one event must resolve the same way every time, not however the
      // table happened to be laid out.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const context = rules.length > 0 ? await this.loadTask(event) : null;

    let executed = 0;
    let skipped = 0;
    const events: AutomationEvent[] = [];
    const webhooks: RuleWebhookRequest[] = [];

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

      const run = await this.runRule(rule, event, context);
      if (run.ran) executed += 1;
      else skipped += 1;
      events.push(...run.events);
      webhooks.push(...run.webhooks);
    }

    /*
     * A completed subtask may have completed its parent's checklist. Worked
     * out here, after this event's own rules, so the parent's event lands
     * behind them in the queue.
     */
    if (event.trigger === AutomationTrigger.TASK_COMPLETED) {
      const rollup = await this.subtaskRollup(event);
      if (rollup) events.push(rollup);
    }

    return { executed, skipped, events, webhooks };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

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
      eventId: randomUUID(),
      entityType: 'TASK',
      entityId: parent.id,
      before: { allSubtasksCompleted: false },
      after: { allSubtasksCompleted: true, subtaskCount: parent.subtasks.length },
    };
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
    const scope = (config ?? {}) as { sectionId?: string; fieldId?: string };

    if (scope.sectionId && event.trigger === 'TASK_MOVED_TO_SECTION') {
      return event.after?.['sectionId'] === scope.sectionId;
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

    const live = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: event.workspaceId },
      include: { customFieldValues: true },
    });

    if (!live) return null;

    return {
      live,
      asFound: { ...live, customFieldValues: live.customFieldValues.map((row) => ({ ...row })) },
    };
  }

  private async runRule(
    rule: {
      id: string;
      name: string;
      workspaceId: string;
      projectId: string;
      nodes: AutomationNode[];
    },
    event: AutomationEvent,
    context: TaskContext | null,
  ): Promise<{ ran: boolean; events: AutomationEvent[]; webhooks: RuleWebhookRequest[] }> {
    const started = Date.now();

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
        depth: event.depth,
      },
    });

    if (!context) {
      await this.finish(execution.id, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason: 'The task no longer exists.',
      });
      return { ran: false, events: [], webhooks: [] };
    }

    // Judged on the task as the event found it, run against the live row:
    // see `TaskContext`.
    const { asFound, live: task } = context;

    // Conditions are all-or-nothing: a rule whose conditions do not hold has
    // not failed, it simply does not apply. Recorded as SKIPPED with a reason
    // so the history distinguishes "did not match" from "went wrong".
    const plan = this.plan(rule.nodes, asFound, event);

    if (plan.skippedBy) {
      await this.finish(execution.id, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason: `Condition not met: ${plan.skippedBy}.`,
      });
      await this.bumpRule(rule.id, AutomationExecutionStatus.SKIPPED);
      return { ran: false, events: [], webhooks: [] };
    }

    const actions = plan.actions.slice(0, MAX_ACTIONS_PER_EXECUTION);

    let failures = 0;
    const events: AutomationEvent[] = [];
    const webhooks: RuleWebhookRequest[] = [];

    for (const node of actions) {
      // One failing action does not abandon the rest: a rule that assigns
      // someone and adds a comment should still comment if the assignment
      // fails, and the log says which did what.
      const outcome = await this.runAction(node, task, rule, event, new Date(started)).catch(
        (error: unknown): ActionOutcome => ({
          succeeded: false,
          message: error instanceof Error ? error.message : 'Action failed.',
        }),
      );

      if (!outcome.succeeded) failures += 1;
      events.push(...(outcome.events ?? []));
      webhooks.push(...(outcome.webhooks ?? []));

      await this.prisma.automationExecutionLog.create({
        data: {
          executionId: execution.id,
          nodeId: node.id,
          nodeType: node.nodeType,
          subtype: node.subtype,
          succeeded: outcome.succeeded,
          message: outcome.message?.slice(0, 500) ?? null,
          beforeValue: (outcome.before ?? null) as Prisma.InputJsonValue,
          afterValue: (outcome.after ?? null) as Prisma.InputJsonValue,
        },
      });
    }

    const status =
      failures === 0
        ? AutomationExecutionStatus.COMPLETED
        : failures === actions.length
          ? AutomationExecutionStatus.FAILED
          : AutomationExecutionStatus.PARTIALLY_FAILED;

    await this.finish(execution.id, status, started, {});
    await this.bumpRule(rule.id, status, failures > 0);

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
    if (actions.length > failures) {
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
            actions: actions.length,
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
       */
      // Both projects when the rule moved the task out of this one: the tab on
      // the old board has to drop the row, and the tab on the new one has to
      // gain it.
      const projectIds = new Set([event.projectId, task.projectId ?? event.projectId]);

      for (const projectId of projectIds) {
        await this.relay.toProject(projectId, ServerEvent.WORK_ITEM_UPDATED, {
          workspaceId: rule.workspaceId,
          projectId,
          occurredAt: new Date().toISOString(),
          source: 'automation',
        });
      }
    }

    return { ran: true, events, webhooks };
  }

  /** Evaluates one condition against the task the event is about. */
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
  private plan(
    nodes: AutomationNode[],
    task: EvaluableTask,
    event: AutomationEvent,
  ): { actions: AutomationNode[]; skippedBy: string | null } {
    const isTree = nodes.some((node) => node.parentNodeId !== null);

    if (!isTree) {
      const unmet = nodes
        .filter((node) => node.nodeType === AutomationNodeType.CONDITION)
        .find((node) => !this.conditionHolds(node, task, event));

      if (unmet) return { actions: [], skippedBy: unmet.subtype };

      return {
        actions: nodes.filter((node) => node.nodeType === AutomationNodeType.ACTION),
        skippedBy: null,
      };
    }

    const trigger = nodes.find((node) => node.nodeType === AutomationNodeType.TRIGGER);
    if (!trigger) return { actions: [], skippedBy: 'no trigger' };

    const actions: AutomationNode[] = [];
    let skippedBy: string | null = null;

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
    const walk = (nodeId: string, arm: string | null, depth: number, rows = false): void => {
      if (depth > 50) return;

      // Which is to say: a row has already claimed this event. Ordering is by
      // `position`, so "first" is the row nearest the top of the canvas.
      let matched = false;

      for (const node of childrenOf(nodeId, arm)) {
        if (node.nodeType === AutomationNodeType.CONDITION) {
          if (rows && matched) continue;

          // A condition governs what follows it, not the whole rule. Its
          // siblings on another path are unaffected.
          if (!this.conditionHolds(node, task, event)) {
            skippedBy ??= node.subtype;
            continue;
          }

          if (rows) matched = true;

          walk(node.id, null, depth + 1);
          continue;
        }

        if (node.nodeType === AutomationNodeType.BRANCH) {
          const holds = this.conditionHolds(node, task, event);

          walk(node.id, holds ? BranchKey.MATCH : BranchKey.ELSE, depth + 1);
          continue;
        }

        if (node.nodeType === AutomationNodeType.ACTION) {
          actions.push(node);
          walk(node.id, null, depth + 1);
        }
      }
    };

    walk(trigger.id, null, 0, true);

    // "Nothing ran" is only a skip when something stopped it. A rule whose
    // branch legitimately led nowhere has run and done nothing.
    return { actions, skippedBy: actions.length === 0 ? skippedBy : null };
  }

  private conditionHolds(
    node: AutomationNode,
    task: EvaluableTask,
    event: AutomationEvent,
  ): boolean {
    const config = (node.configuration ?? {}) as {
      field?: string;
      operator?: string;
      value?: unknown;
    };

    /*
     * The fallback row holds, always.
     *
     * "If all other conditions are not met" is what makes it the last row
     * rather than a comparison of its own — it has no field and no operator, so
     * every branch below would read it as an unknown operator and return false,
     * and the one row somebody added to catch everything would catch nothing.
     */
    if (isFallbackBranch(node.configuration)) return true;

    const actual = this.readField(config.field ?? node.subtype, task, event);
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
      case FilterOperator.GREATER_THAN:
        return Number(actual) > Number(expected);
      case FilterOperator.LESS_THAN:
        return Number(actual) < Number(expected);
      /*
       * The inclusive bounds, which the builder offered on every number field
       * and the translation table knew, and this switch did not — so "at least
       * 30" fell to the default and was false on every event.
       */
      case FilterOperator.GREATER_THAN_OR_EQUAL:
        return Number(actual) >= Number(expected);
      case FilterOperator.LESS_THAN_OR_EQUAL:
        return Number(actual) <= Number(expected);

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

      default:
        return event.after?.[field];
    }
  }

  private async runAction(
    node: AutomationNode,
    task: EvaluableTask,
    rule: { id: string; workspaceId: string; projectId: string },
    event: AutomationEvent,
    /* When this execution began, so every action in one run agrees. */
    at: Date,
  ): Promise<ActionOutcome> {
    const config = (node.configuration ?? {}) as Record<string, unknown>;

    switch (node.subtype) {
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

        const before = task.assigneeId;
        const events = await this.updateTask(task, { assigneeId: userId }, rule, event);
        return { succeeded: true, before, after: userId, events };
      }

      case AutomationAction.UNASSIGN_USER: {
        const before = task.assigneeId;
        const events = await this.updateTask(task, { assigneeId: null }, rule, event);
        return { succeeded: true, before, after: null, events };
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
        const events = await this.updateTask(task, { sectionId }, rule, event);
        return { succeeded: true, before, after: sectionId, events };
      }

      case AutomationAction.MOVE_TO_PROJECT: {
        const projectId = String(config['projectId'] ?? '');
        const requestedSectionId = String(config['targetSectionId'] ?? '');

        if (projectId === task.projectId) {
          return { succeeded: false, message: 'The task is already in that project.' };
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

        return { succeeded: true, before, after: { projectId: project.id, sectionId }, events };
      }

      case AutomationAction.UPDATE_STATUS: {
        const status = readActionId(config, 'status');
        if (!status) return { succeeded: false, message: 'No status was chosen.' };

        const data = statusData(status);
        const before = task.status;

        const events = await this.updateTask(
          task,
          {
            ...data,
            // Completion is a fact about the task, not a separate action
            // somebody has to remember to add to the rule. Kept in step the
            // way a person's edit keeps it — stamped once on the way into
            // DONE, cleared on the way out — so TASK_COMPLETED means it.
            ...(data.status === TaskStatus.DONE && task.completedAt === null
              ? { completedAt: new Date() }
              : {}),
            ...(data.status !== undefined &&
            data.status !== TaskStatus.DONE &&
            task.completedAt !== null
              ? { completedAt: null }
              : {}),
          },
          rule,
          event,
        );

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
        // Relative rather than absolute: "due in three days" stays meaningful,
        // where a fixed date written into a rule is stale the week after.
        const days = Number(config['daysFromNow'] ?? 0);
        const due = new Date();
        due.setUTCDate(due.getUTCDate() + days);

        // A rule sets a day, not a moment: the calendar date at UTC midnight,
        // the shape every date column holds, and no time of day carried over
        // from whatever the task had before.
        const dueDate = toCalendarDate(due);
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

      case AutomationAction.ADD_COMMENT: {
        const body = String(config['body'] ?? '').trim();
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
        const entries = subtaskEntries(config);
        if (entries.length === 0) {
          return { succeeded: false, message: 'The subtasks have no titles.' };
        }

        /*
         * Membership is re-checked at execution time, as ASSIGN_USER's is —
         * but a person who has left costs their row its assignee, not the
         * checklist its existence. The rule's job is the subtasks; a departed
         * name is reported in the log here and refused by the validator the
         * next time the rule is edited.
         */
        const named = [
          ...new Set(entries.flatMap((entry) => (entry.assigneeId ? [entry.assigneeId] : []))),
        ];
        const members = named.length
          ? await this.prisma.workspaceMember.findMany({
              where: { workspaceId: rule.workspaceId, userId: { in: named } },
              select: { userId: true },
            })
          : [];
        const live = new Set(members.map((member) => member.userId));
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
              title: entry.title,
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

        return {
          succeeded: true,
          after: created.join(', '),
          ...(departed > 0
            ? {
                message: `${departed} subtask${departed === 1 ? ' was' : 's were'} left unassigned: the person named is no longer in this workspace.`,
              }
            : {}),
          events,
        };
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

    const [users, sections] = await Promise.all([
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
    ]);

    const userRef = (id: string | null) => {
      const user = users.find((row) => row.id === id);
      return user ? { id: user.id, label: user.name } : null;
    };
    const sectionRef = (id: string | null) => {
      const section = sections.find((row) => row.id === id);
      return section ? { id: section.id, label: section.name } : null;
    };

    const stories = diffItemStories(
      snapshotFromTask(before, {
        assignee: userRef(before.assigneeId),
        section: sectionRef(before.sectionId),
      }),
      snapshotFromTask(updated, {
        assignee: userRef(updated.assigneeId),
        section: sectionRef(updated.sectionId),
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
        triggerType: event.trigger,
      },
      select: { id: true, workspaceId: true },
    });

    if (!rule) return;

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
        depth: event.depth,
        skippedReason: reason,
        finishedAt: new Date(),
      },
    });
  }
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

  return null;
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

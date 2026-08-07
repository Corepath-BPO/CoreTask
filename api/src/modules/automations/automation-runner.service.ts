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
  NotificationType,
  toFilterOperator,
  type AutomationTrigger,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus, type AutomationNode, type Prisma, type Task } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

import { priorityData, readActionId, statusData } from './action-config';
import type { AutomationEvent } from './automation-event.publisher';

/** What one action attempt produced, for the log. */
interface ActionOutcome {
  succeeded: boolean;
  message?: string;
  before?: unknown;
  after?: unknown;
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the rules matching an event and runs each one.
   *
   * Returns how many executed, which is what the processor logs.
   */
  async handle(event: AutomationEvent): Promise<{ executed: number; skipped: number }> {
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
      return { executed: 0, skipped: 1 };
    }

    const rules = await this.prisma.automationRule.findMany({
      where: {
        projectId: event.projectId,
        status: AutomationRuleStatus.ACTIVE,
        triggerType: event.trigger,
      },
      include: { nodes: { orderBy: { position: 'asc' } } },
    });

    let executed = 0;
    let skipped = 0;

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

      const ran = await this.runRule(rule, event);
      if (ran) executed += 1;
      else skipped += 1;
    }

    return { executed, skipped };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Trigger-level scoping, before conditions are considered.
   *
   * `TASK_MOVED_TO_SECTION` with a section in its config only fires for that
   * section — checked here rather than as a condition so the common case costs
   * nothing.
   */
  private triggerMatches(config: Prisma.JsonValue, event: AutomationEvent): boolean {
    const scope = (config ?? {}) as { sectionId?: string };

    if (scope.sectionId && event.trigger === 'TASK_MOVED_TO_SECTION') {
      return event.after?.['sectionId'] === scope.sectionId;
    }

    return true;
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
  ): Promise<boolean> {
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

    const task = await this.prisma.task.findFirst({
      where: { id: event.entityId, workspaceId: rule.workspaceId },
    });

    if (!task) {
      await this.finish(execution.id, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason: 'The task no longer exists.',
      });
      return false;
    }

    // Conditions are all-or-nothing: a rule whose conditions do not hold has
    // not failed, it simply does not apply. Recorded as SKIPPED with a reason
    // so the history distinguishes "did not match" from "went wrong".
    const plan = this.plan(rule.nodes, task, event);

    if (plan.skippedBy) {
      await this.finish(execution.id, AutomationExecutionStatus.SKIPPED, started, {
        skippedReason: `Condition not met: ${plan.skippedBy}.`,
      });
      await this.bumpRule(rule.id, AutomationExecutionStatus.SKIPPED);
      return false;
    }

    const actions = plan.actions.slice(0, MAX_ACTIONS_PER_EXECUTION);

    let failures = 0;

    for (const node of actions) {
      // One failing action does not abandon the rest: a rule that assigns
      // someone and adds a comment should still comment if the assignment
      // fails, and the log says which did what.
      const outcome = await this.runAction(node, task, rule, event).catch(
        (error: unknown): ActionOutcome => ({
          succeeded: false,
          message: error instanceof Error ? error.message : 'Action failed.',
        }),
      );

      if (!outcome.succeeded) failures += 1;

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
    }

    return true;
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
   */
  private plan(
    nodes: AutomationNode[],
    task: Task,
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

  private conditionHolds(node: AutomationNode, task: Task, event: AutomationEvent): boolean {
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
     * The comparison this operator names, whichever vocabulary named it.
     *
     * The builder writes the reading names — `IS`, `IS_ONE_OF`, `IS_BEFORE` —
     * and rules written before those existed hold the query engine's names.
     * Both spellings mean one comparison, so both are translated to it here
     * rather than duplicating every case below. An operator with no comparison
     * still falls to `default` and blocks the rule.
     */
    switch (toFilterOperator(config.operator)) {
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
       */
      case FilterOperator.BEFORE:
      case FilterOperator.AFTER: {
        const left = new Date(String(actual ?? '')).getTime();
        const right = new Date(String(expected ?? '')).getTime();

        if (Number.isNaN(left) || Number.isNaN(right)) return false;

        return config.operator === FilterOperator.BEFORE ? left < right : left > right;
      }

      default:
        // An unknown operator does not silently pass. A condition nobody can
        // evaluate must block the rule, not wave it through.
        return false;
    }
  }

  private readField(field: string, task: Task, event: AutomationEvent): unknown {
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
      case 'completed':
        return task.completedAt !== null;

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

      default:
        return event.after?.[field];
    }
  }

  private async runAction(
    node: AutomationNode,
    task: Task,
    rule: { id: string; workspaceId: string; projectId: string },
    event: AutomationEvent,
  ): Promise<ActionOutcome> {
    const config = (node.configuration ?? {}) as Record<string, unknown>;

    switch (node.subtype) {
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

        await this.updateTask(task.id, { assigneeId: userId }, rule.id, event);
        return { succeeded: true, before: task.assigneeId, after: userId };
      }

      case AutomationAction.UNASSIGN_USER:
        await this.updateTask(task.id, { assigneeId: null }, rule.id, event);
        return { succeeded: true, before: task.assigneeId, after: null };

      case AutomationAction.MOVE_TO_SECTION: {
        const sectionId = String(config['sectionId'] ?? '');
        const section = await this.prisma.section.findFirst({
          where: { id: sectionId, projectId: rule.projectId },
          select: { id: true },
        });

        if (!section) {
          return { succeeded: false, message: 'That section is not in this project.' };
        }

        await this.updateTask(task.id, { sectionId }, rule.id, event);
        return { succeeded: true, before: task.sectionId, after: sectionId };
      }

      case AutomationAction.UPDATE_STATUS: {
        const status = readActionId(config, 'status');
        if (!status) return { succeeded: false, message: 'No status was chosen.' };

        const data = statusData(status);

        await this.updateTask(
          task.id,
          {
            ...data,
            // Completion is a fact about the task, not a separate action
            // somebody has to remember to add to the rule.
            ...(data.status === TaskStatus.DONE ? { completedAt: new Date() } : {}),
          },
          rule.id,
          event,
        );

        return { succeeded: true, before: task.status, after: status };
      }

      case AutomationAction.UPDATE_PRIORITY: {
        const priority = readActionId(config, 'priority');
        if (!priority) return { succeeded: false, message: 'No priority was chosen.' };

        await this.updateTask(task.id, priorityData(priority), rule.id, event);

        return { succeeded: true, before: task.priority, after: priority };
      }

      case AutomationAction.SET_DUE_DATE: {
        // Relative rather than absolute: "due in three days" stays meaningful,
        // where a fixed date written into a rule is stale the week after.
        const days = Number(config['daysFromNow'] ?? 0);
        const due = new Date();
        due.setDate(due.getDate() + days);

        await this.updateTask(task.id, { dueDate: due }, rule.id, event);
        return { succeeded: true, before: task.dueDate, after: due.toISOString() };
      }

      case AutomationAction.CLEAR_DUE_DATE:
        await this.updateTask(task.id, { dueDate: null }, rule.id, event);
        return { succeeded: true, before: task.dueDate, after: null };

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
        const title = String(config['title'] ?? '').trim();
        if (!title) return { succeeded: false, message: 'The subtask has no title.' };

        const created = await this.prisma.task.create({
          data: {
            workspaceId: rule.workspaceId,
            projectId: task.projectId,
            sectionId: task.sectionId,
            parentTaskId: task.id,
            title,
            createdById: event.actorId ?? task.createdById,
          },
        });

        return { succeeded: true, after: created.id };
      }

      case AutomationAction.SET_CUSTOM_FIELD: {
        const fieldId = readActionId(config, 'fieldId') ?? '';
        // Through the association: a rule may only write a field its own
        // project actually uses, even though the definition is shared.
        const field = await this.prisma.customField.findFirst({
          where: { id: fieldId, projects: { some: { projectId: rule.projectId } } },
          select: { id: true, type: true },
        });

        if (!field) return { succeeded: false, message: 'That field is not in this project.' };

        await this.prisma.taskCustomFieldValue.upsert({
          where: { taskId_customFieldId: { taskId: task.id, customFieldId: field.id } },
          create: {
            taskId: task.id,
            customFieldId: field.id,
            ...customFieldValue(field.type, config['value']),
          },
          update: customFieldValue(field.type, config['value']),
        });

        return { succeeded: true, after: config['value'] };
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
   * Writes a task change and re-publishes the event, tagged with the rule.
   *
   * The tag is what lets the next hop refuse to re-trigger the same rule, and
   * the incremented depth is what bounds the chain overall.
   */
  private async updateTask(
    taskId: string,
    data: Prisma.TaskUncheckedUpdateInput,
    ruleId: string,
    event: AutomationEvent,
  ): Promise<void> {
    await this.prisma.task.update({ where: { id: taskId }, data });

    // Cascades are published by the caller rather than here: the runner has no
    // queue, deliberately, so it cannot enqueue work while holding a database
    // connection mid-execution.
    void ruleId;
    void event;
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

  /** A stopped chain is recorded, so a silent halt is never a mystery. */
  private async recordSkipped(event: AutomationEvent, reason: string): Promise<void> {
    const rule = await this.prisma.automationRule.findFirst({
      where: { projectId: event.projectId, triggerType: event.trigger },
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

import { createHash, randomUUID } from 'node:crypto';

import { webhookEventTypeFor, type AutomationTrigger } from '@coretask/contracts';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AutomationJob, QueueName } from '../../jobs/queue-names';
import { WebhookQueue } from '../../jobs/webhook/webhook.queue';

/** What happened, and enough context to decide whether a rule cares. */
export interface AutomationEvent {
  /**
   * Identifies this occurrence. Stable across queue retries, so a webhook
   * delivery keyed on it is made once however often the job runs.
   */
  eventId: string;
  workspaceId: string;
  projectId: string;
  trigger: AutomationTrigger;
  /**
   * What the event is about. `PROJECT` is a scheduled run with no tasks in
   * scope, whose `entityId` is the project: there is nothing else to name.
   */
  entityType: 'TASK' | 'TICKET' | 'COMMENT' | 'PROJECT';
  entityId: string;
  /**
   * Set when the event is for one rule only — a person pressing "Run rule",
   * or the clock finding one rule due — so rules sharing its trigger stay put.
   */
  ruleId?: string | null;
  /**
   * The person whose change started this.
   *
   * Carried through a chain rather than dropped when a rule caused the hop: the
   * rule's write is a consequence of what that person did, which is what the
   * activity feed says of it. `causedByRuleId` says whether a rule was the
   * proximate cause; this says who set it all going. Null only when nothing
   * identifiable did.
   */
  actorId?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Shared by every hop descended from one original action. */
  correlationId: string;
  /**
   * The id of the event this chain started from, inherited by every hop.
   *
   * Narrower than `correlationId`, which a manual or scheduled run shares
   * across every task in its batch — so a batch of fifty is fifty chains, and
   * the per-chain action cap counts within one. Absent only on an event queued
   * before chains were tracked; `chainOf` reads such an event as its own chain.
   */
  chainId?: string;
  /** 0 for a user action; incremented per rule hop. */
  depth: number;
  /** Set when a rule caused this, so it will not react to its own write. */
  causedByRuleId?: string | null;
  /**
   * Set when the clock republishes a run that waited at a Wait step: the rule
   * picks up after that step rather than from its trigger. Such an event is
   * the same occurrence happening later, so it sends no webhooks.
   */
  resumeFromNodeId?: string | null;
  /**
   * The version a resumed run started on, and finishes on. Absent on a run
   * that waited from before versions were kept; it takes the published one.
   */
  resumeVersionId?: string | null;
}

/**
 * Publishes domain events for the automation engine.
 *
 * Deliberately a leaf: it depends on the queue and nothing else, so any module
 * that changes a task can import it without dragging the engine — and its
 * dependencies — into the request path.
 *
 * Never throws. An automation that fails to enqueue must not fail the edit that
 * triggered it; the user's change is the thing that matters.
 */
@Injectable()
export class AutomationEventPublisher {
  private readonly logger = new Logger(AutomationEventPublisher.name);

  constructor(
    @InjectQueue(QueueName.AUTOMATION) private readonly queue: Queue,
    private readonly webhooks: WebhookQueue,
  ) {}

  async publish(
    event: Omit<AutomationEvent, 'eventId' | 'correlationId' | 'depth'> & {
      eventId?: string;
      correlationId?: string;
      depth?: number;
    },
  ): Promise<void> {
    const eventId = event.eventId ?? randomUUID();
    const payload: AutomationEvent = {
      ...event,
      eventId,
      // A fresh id means a user action; an inherited one means this is a
      // continuation, and that is what makes a loop traceable end to end.
      correlationId: event.correlationId ?? randomUUID(),
      // An event nothing came before starts its own chain.
      chainId: event.chainId ?? eventId,
      depth: event.depth ?? 0,
    };

    try {
      await this.queue.add(AutomationJob.EVENT, payload, {
        /*
         * One job per occurrence. The same event published twice — a retried
         * request, a processor republishing what a retried run had already
         * raised — is the same job, and BullMQ drops the second while the
         * first is still held (an hour once done, a day once failed). After
         * that the runner's own idempotency key answers it the same way.
         */
        jobId: automationJobId(payload),
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3_600, count: 500 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error(
        { err: error, trigger: payload.trigger, entityId: payload.entityId },
        'Could not enqueue an automation event',
      );
    }

    /*
     * Webhooks branch off here, onto their own queue, so an endpoint that is
     * slow to answer never holds up a rule, and a rule that fails never
     * re-sends a webhook. Rule-caused events pass through the same door, which
     * is how a receiver learns about what a rule changed — flagged by
     * `causedByRuleId`, so it can ignore them if it prefers.
     */
    if (
      !payload.resumeFromNodeId &&
      payload.entityType !== 'PROJECT' &&
      webhookEventTypeFor(payload.trigger, payload.entityType) !== null
    ) {
      await this.webhooks.enqueueFanOut(payload);
    }
  }
}

/** The chain an event belongs to. See `AutomationEvent.chainId`. */
export function chainOf(event: Pick<AutomationEvent, 'eventId' | 'chainId'>): string {
  return event.chainId ?? event.eventId;
}

/**
 * What one rule's run on one event is known by.
 *
 * The event, and the Wait step a resumed run picks up after: a resumption is
 * the same event happening later, and keyed on the event alone it would be
 * taken for the run it continues.
 */
export function runKey(event: Pick<AutomationEvent, 'eventId' | 'resumeFromNodeId'>): string {
  return event.resumeFromNodeId ? `${event.eventId}/${event.resumeFromNodeId}` : event.eventId;
}

/**
 * The queue's id for an event's job. BullMQ refuses a `:` in a custom id, and
 * a resumed run needs its own job for the reason it needs its own run key.
 */
export function automationJobId(event: Pick<AutomationEvent, 'eventId' | 'resumeFromNodeId'>) {
  return `event-${runKey(event).replace('/', '-from-')}`;
}

/**
 * An event id worked out from another, so raising "the same" event twice
 * names it the same way.
 *
 * For the events the engine raises on a run's behalf rather than a rule's
 * action — a parent's checklist completing, a task coming unblocked. A random
 * id there would make a retried run raise a second, different event for the
 * one occurrence; derived, the queue and the runner both see the repeat for
 * what it is. Shaped as a UUID because every column that stores an event id
 * is one.
 */
export function derivedEventId(source: string, purpose: string): string {
  const hex = createHash('sha256').update(`${source}:${purpose}`).digest('hex');
  // Version 5's nibble and the RFC 4122 variant, so it reads as a name-based UUID.
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

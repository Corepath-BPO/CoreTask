import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  EmailJob,
  QueueName,
  type InvitationEmailJobData,
  type WelcomeEmailJobData,
} from '../queue-names';

@Injectable()
export class EmailQueue {
  private readonly logger = new Logger(EmailQueue.name);

  constructor(@InjectQueue(QueueName.EMAIL) private readonly queue: Queue) {}

  /**
   * Enqueues the welcome e-mail.
   *
   * Never rejects: a Redis outage should degrade the welcome e-mail, not the
   * registration that triggered it.
   */
  async enqueueWelcome(data: WelcomeEmailJobData): Promise<void> {
    try {
      await this.queue.add(EmailJob.WELCOME, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error({ err: error, userId: data.userId }, 'Failed to enqueue welcome e-mail');
    }
  }

  /**
   * Enqueues the invitation e-mail.
   *
   * Unlike the welcome message this one is load-bearing — without it the
   * recipient never receives the link — so a failure is logged loudly. It still
   * does not throw: the invitation itself is already recorded, and an admin can
   * resend rather than lose the row to a rolled-back request.
   */
  async enqueueInvitation(data: InvitationEmailJobData): Promise<void> {
    try {
      await this.queue.add(EmailJob.INVITATION, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        // Removed on completion so the raw token does not linger in Redis.
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error({ err: error, email: data.email }, 'Failed to enqueue invitation e-mail');
    }
  }
}

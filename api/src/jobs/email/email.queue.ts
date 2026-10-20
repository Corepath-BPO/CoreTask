import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  EmailJob,
  QueueName,
  type InvitationEmailJobData,
  type MessageEmailJobData,
  type EmailVerificationJobData,
  type PasswordResetEmailJobData,
} from '../queue-names';

@Injectable()
export class EmailQueue {
  private readonly logger = new Logger(EmailQueue.name);

  constructor(@InjectQueue(QueueName.EMAIL) private readonly queue: Queue) {}

  /**
   * Enqueues a "confirm your e-mail address" link — on sign-up, where it is
   * also the welcome.
   *
   * Never rejects: a Redis outage should cost the link, not the registration
   * or the request that asked for it. A new link can always be sent.
   */
  async enqueueEmailVerification(data: EmailVerificationJobData): Promise<void> {
    try {
      await this.queue.add(EmailJob.EMAIL_VERIFICATION, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        // Removed on completion so the raw token does not linger in Redis.
        removeOnComplete: true,
        removeOnFail: { age: 3_600 },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Failed to enqueue an e-mail confirmation',
      );
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

  /**
   * Enqueues a message the API has already written. Never rejects: these are
   * updates to an email thread, and the comment behind one is already saved.
   */
  async enqueueMessage(data: MessageEmailJobData): Promise<void> {
    try {
      await this.queue.add(EmailJob.MESSAGE, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error({ err: error, to: data.to }, 'Failed to enqueue an e-mail message');
    }
  }

  /**
   * Enqueues a "forgot password" link. Load-bearing like an invitation — it is
   * the only way back into the account — so a failure is logged loudly, but
   * never thrown: the answer to the request must not depend on it.
   */
  async enqueuePasswordReset(data: PasswordResetEmailJobData): Promise<void> {
    try {
      await this.queue.add(EmailJob.PASSWORD_RESET, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        // Removed on completion so the raw token does not linger in Redis.
        removeOnComplete: true,
        removeOnFail: { age: 3_600 },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to enqueue a password reset e-mail');
    }
  }
}

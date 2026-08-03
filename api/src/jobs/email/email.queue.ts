import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { EmailJob, QueueName, type WelcomeEmailJobData } from '../queue-names';

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
}

import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

import { EmailQueue } from './email/email.queue';
import { QueueName } from './queue-names';

/**
 * Producer side of the queue layer: registers the BullMQ connection and the
 * queues, but no processors. Consumers live in `WorkerModule` so the API
 * process never competes with the worker for jobs.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        connection: redis.connectionOptions(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 86_400 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QueueName.EMAIL }),
    BullModule.registerQueue({ name: QueueName.MAINTENANCE }),
  ],
  providers: [EmailQueue],
  exports: [BullModule, EmailQueue],
})
export class JobsModule {}

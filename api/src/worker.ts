// Must run before anything reads configuration.
import './config/load-env';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { EnvValidationError, getEnv } from './config/env';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const env = getEnv();

  // No HTTP server: the worker only consumes queues.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  logger.log(`CoreTask worker started (${env.NODE_ENV})`);

  // Keeps the process alive until a shutdown signal drains the BullMQ workers.
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        logger.log(`Received ${signal}, shutting down`);
        void app.close().then(resolve);
      });
    }
  });
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    // The logger is not up yet, so this goes straight to stderr.
    console.error(error.message);
    process.exit(1);
  }

  console.error('Failed to start the CoreTask worker:', error);
  process.exit(1);
});

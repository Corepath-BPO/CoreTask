// Must run before anything reads configuration.
import './config/load-env';

import { API_DOCS_PATH, API_PREFIX } from '@coretask/contracts';
import { Logger } from '@nestjs/common';

import { createApp } from './bootstrap/create-app';
import { EnvValidationError, getEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Validate before Nest starts so a bad deploy fails with a readable message
  // instead of a dependency-injection stack trace.
  const env = getEnv();

  const app = await createApp();
  await app.listen(env.API_PORT, '0.0.0.0');

  logger.log(`CoreTask API listening on port ${env.API_PORT} (${env.NODE_ENV})`);
  logger.log(`REST      ${env.API_URL}${API_PREFIX}`);
  logger.log(`Swagger   ${env.API_URL}${API_DOCS_PATH}`);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    // The logger is not up yet, so this goes straight to stderr.
    console.error(error.message);
    process.exit(1);
  }

  console.error('Failed to start the CoreTask API:', error);
  process.exit(1);
});

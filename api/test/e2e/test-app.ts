import type { INestApplication } from '@nestjs/common';

import { createApp } from '../../src/bootstrap/create-app';
import { PrismaService } from '../../src/database/prisma.service';

import { buildE2eDatabaseUrl } from './test-database';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

/**
 * Boots the real application.
 *
 * Deliberately not a trimmed-down testing module: the specs must exercise the
 * same global pipe, filter, interceptor and guard stack that production runs,
 * because that stack is where the response envelope and tenant isolation live.
 */
export async function createTestContext(): Promise<TestContext> {
  process.env['DATABASE_URL'] = buildE2eDatabaseUrl();

  const app = await createApp();
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

export async function closeTestContext(context: TestContext): Promise<void> {
  await context.app.close();
}

/** Random address so parallel specs cannot collide on a unique constraint. */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@coretask.test`;
}

export const VALID_PASSWORD = 'CoreTask!2024';

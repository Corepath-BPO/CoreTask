import type { INestApplication } from '@nestjs/common';

import { createApp } from '../../src/bootstrap/create-app';
import { PrismaService } from '../../src/database/prisma.service';

import { buildE2eDatabaseUrl, E2E_QUEUE_PREFIX } from './test-database';

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
  // Assigned, not defaulted: a developer's .env may name the worker's prefix.
  process.env['QUEUE_PREFIX'] = E2E_QUEUE_PREFIX;

  const app = await createApp();
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

export async function closeTestContext(context: TestContext): Promise<void> {
  await context.app.close();
}

/**
 * Marks an account's address confirmed, as following the e-mailed link would.
 * Inviting people and connecting integrations need a confirmed address, and
 * the link itself is the worker's business, not these specs'.
 */
export async function confirmEmail(context: TestContext, userId: string): Promise<void> {
  await context.prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
  });
}

/** Random address so parallel specs cannot collide on a unique constraint. */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@coretask.test`;
}

export const VALID_PASSWORD = 'CoreTask!2024';

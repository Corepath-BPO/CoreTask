import type { PrismaService } from '../../database/prisma.service';

/** One ask per hour reaches a person; more in that time are taken as sent. */
export const STATUS_REQUEST_WINDOW_MS = 60 * 60_000;

/**
 * Whether `userId` was already asked, in these words, within the window — so a
 * button pressed twice, or by several people, is not a pile of notifications.
 */
export async function askedRecently(
  prisma: PrismaService,
  userId: string,
  title: string,
): Promise<boolean> {
  const since = new Date(Date.now() - STATUS_REQUEST_WINDOW_MS);
  const recent = await prisma.notification.findFirst({
    where: { userId, title, createdAt: { gte: since } },
    select: { id: true },
  });
  return recent !== null;
}

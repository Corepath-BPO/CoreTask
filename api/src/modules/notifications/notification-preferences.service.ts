import { emailGroupOf, readEmailGroups, type NotificationEmailGroup } from '@coretask/contracts';
import type { NotificationPreferences } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

/**
 * Which notifications someone also gets by email, per workspace. Without a
 * row the defaults hold — assignments and mentions — so a new member hears of
 * work handed to them without having visited Settings first.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(workspaceId: string, userId: string): Promise<NotificationPreferences> {
    const [row, user] = await Promise.all([
      this.prisma.notificationPreference.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    ]);
    return { emailGroups: readEmailGroups(row?.emailGroups ?? null), emailAddress: user.email };
  }

  async set(
    workspaceId: string,
    userId: string,
    groups: readonly NotificationEmailGroup[],
  ): Promise<NotificationPreferences> {
    const emailGroups = readEmailGroups(groups);
    await this.prisma.notificationPreference.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, emailGroups },
      update: { emailGroups },
    });
    return this.get(workspaceId, userId);
  }

  /** Whether a notification of this type should also be emailed to this person. */
  async wantsEmail(workspaceId: string, userId: string, type: string): Promise<boolean> {
    const group = emailGroupOf(type);
    if (!group) return false;
    const row = await this.prisma.notificationPreference.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { emailGroups: true },
    });
    return readEmailGroups(row?.emailGroups ?? null).includes(group);
  }
}

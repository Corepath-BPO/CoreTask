import { isTimeZone } from '@coretask/contracts';
import type { AuthUser, OutOfOffice, UpdateProfilePayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
  timezone?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** E-mail comparison is case-insensitive; the normalised form is what we store. */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: UsersService.normalizeEmail(email) },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async requireById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'User not found.');
    }
    return user;
  }

  async create(input: CreateUserInput, tx?: Prisma.TransactionClient): Promise<User> {
    const client = tx ?? this.prisma;

    return client.user.create({
      data: {
        email: UsersService.normalizeEmail(input.email),
        name: input.name.trim(),
        passwordHash: input.passwordHash,
        timezone: input.timezone ?? 'UTC',
      },
    });
  }

  async markLoggedIn(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  /** Projection sent to clients. The password hash never leaves this layer. */
  static toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      pronouns: user.pronouns,
      jobTitle: user.jobTitle,
      department: user.department,
      aboutMe: user.aboutMe,
      outOfOffice: UsersService.outOfOfficeOf(user),
    };
  }

  /** The time off a row holds, as calendar days; null unless both ends are set. */
  static outOfOfficeOf(user: {
    outOfOfficeFrom: Date | null;
    outOfOfficeUntil: Date | null;
    outOfOfficeNote: string | null;
  }): OutOfOffice | null {
    if (!user.outOfOfficeFrom || !user.outOfOfficeUntil) return null;
    return {
      from: user.outOfOfficeFrom.toISOString().slice(0, 10),
      until: user.outOfOfficeUntil.toISOString().slice(0, 10),
      note: user.outOfOfficeNote,
    };
  }

  /**
   * The caller's own profile, field by field. Text is trimmed and an empty
   * box clears it; time off runs from one day to a later (or the same) one.
   */
  async updateProfile(userId: string, input: UpdateProfilePayload): Promise<AuthUser> {
    const text = (value: string | null | undefined) =>
      value === undefined ? undefined : value?.trim() || null;
    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw AppException.badRequest('BAD_REQUEST', 'A name cannot be empty.');
      data.name = name;
    }
    if (input.timezone !== undefined) {
      if (!isTimeZone(input.timezone)) {
        throw AppException.badRequest('BAD_REQUEST', 'That is not a time zone this server knows.');
      }
      data.timezone = input.timezone;
    }
    if (input.pronouns !== undefined) data.pronouns = text(input.pronouns);
    if (input.jobTitle !== undefined) data.jobTitle = text(input.jobTitle);
    if (input.department !== undefined) data.department = text(input.department);
    if (input.aboutMe !== undefined) data.aboutMe = text(input.aboutMe);
    if (input.outOfOffice !== undefined) {
      const period = input.outOfOffice;
      if (period === null) {
        data.outOfOfficeFrom = null;
        data.outOfOfficeUntil = null;
        data.outOfOfficeNote = null;
      } else {
        if (period.until < period.from) {
          throw AppException.badRequest(
            'BAD_REQUEST',
            'Time off has to end on or after it starts.',
          );
        }
        data.outOfOfficeFrom = new Date(`${period.from}T00:00:00.000Z`);
        data.outOfOfficeUntil = new Date(`${period.until}T00:00:00.000Z`);
        data.outOfOfficeNote = text(period.note) ?? null;
      }
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return UsersService.toAuthUser(user);
  }
}

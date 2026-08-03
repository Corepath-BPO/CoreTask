import type { AuthUser } from '@coretask/types';
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
    };
  }
}

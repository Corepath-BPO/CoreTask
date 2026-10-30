import {
  ActivityAction,
  ActivityEntity,
  IdentityProvider,
  type SocialSsoProvider,
  WorkspaceRole,
} from '@coretask/contracts';
import type { LinkedIdentity, SsoProviders } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type SamlConnection, type User } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { SecurityNotices } from '../auth/security-notices';
import { UsersService } from '../users/users.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

import type { VerifiedIdentity } from './lib/oidc';
import type { SamlAssertion } from './lib/saml';

const SOCIAL_PROVIDERS: Record<SocialSsoProvider, IdentityProvider> = {
  google: IdentityProvider.GOOGLE,
  microsoft: IdentityProvider.MICROSOFT,
};

const PROVIDER_LABELS: Record<IdentityProvider, string> = {
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
  SAML: 'Single sign-on',
};

/** What an identity needs saying when it is written: who, where from, and what address. */
interface IdentityInput {
  provider: IdentityProvider;
  subject: string;
  email: string;
  samlConnectionId?: string;
  /** Written while signing in with it, rather than connecting it from Settings. */
  signingIn?: boolean;
}

/**
 * Who someone is once Google, Microsoft or their workspace's identity
 * provider has vouched for them: the CoreTask account to sign in, made or
 * connected as needed, and the outside accounts connected to each person.
 *
 * Identities are matched on the provider's subject, never on the address —
 * an address can change hands at the provider, a subject cannot. An address
 * counts only to find an account for a subject seen for the first time, and
 * then only when the provider vouches for it: Google's `email_verified`,
 * Microsoft's verified-domain claim, or a domain the workspace has proved is
 * its own.
 */
@Injectable()
export class SsoAccountsService {
  private readonly logger = new Logger(SsoAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly users: UsersService,
    private readonly members: WorkspaceMembersService,
    private readonly activity: ActivityLogsService,
    private readonly notices: SecurityNotices,
  ) {}

  providers(): SsoProviders {
    return {
      google: this.config.sso.google.enabled,
      microsoft: this.config.sso.microsoft.enabled,
      saml: true,
    };
  }

  /**
   * Signing in with Google or Microsoft. The account the subject is
   * connected to; else the account with the vouched-for address — once that
   * account has confirmed it, or when nobody can sign in to it yet — which it
   * is connected to now; else a new account. An address the provider does not
   * vouch for opens nothing.
   */
  async signInWithSocial(
    name: SocialSsoProvider,
    identity: VerifiedIdentity,
    retry = true,
  ): Promise<User> {
    const provider = SOCIAL_PROVIDERS[name];
    const known = await this.findIdentity(provider, identity.subject);
    if (known) {
      assertCanSignIn(known.user);
      await this.touch(known.id, identity.email);
      return known.user;
    }

    if (!identity.emailTrusted) throw AppException.forbidden('SSO_EMAIL_UNVERIFIED');

    const input: IdentityInput = {
      provider,
      subject: identity.subject,
      email: identity.email,
      signingIn: true,
    };
    try {
      const existing = await this.users.findByEmail(identity.email);
      if (existing) {
        assertCanClaimByAddress(existing, await this.connections(existing.id));
        const user = await this.connect(existing, input, { emailProven: true });
        this.logger.log(
          { userId: user.id, provider },
          'Connected a sign-in by its verified address',
        );
        return user;
      }

      const user = await this.prisma.$transaction(async (tx) => {
        const created = await this.users.create(
          {
            email: identity.email,
            name: identity.name ?? localPart(identity.email),
            passwordHash: null,
            emailVerifiedAt: new Date(),
          },
          tx,
        );
        await tx.userIdentity.create({ data: identityData(created.id, input) });
        return created;
      });
      this.logger.log({ userId: user.id, provider }, 'Created an account by single sign-on');
      return user;
    } catch (error) {
      // Two first sign-ins at once: one made the account or the connection,
      // and the other finds it on a second look.
      if (retry && isUniqueViolation(error)) return this.signInWithSocial(name, identity, false);
      throw error;
    }
  }

  /**
   * Connecting Google or Microsoft from Settings. The person is signed in
   * and matched by subject, so the address need not be vouched for: it is
   * only shown. One account per provider; connecting another replaces it.
   */
  async linkSocial(
    userId: string,
    name: SocialSsoProvider,
    identity: VerifiedIdentity,
  ): Promise<void> {
    const user = await this.users.requireById(userId);
    assertCanSignIn(user);
    const provider = SOCIAL_PROVIDERS[name];

    const known = await this.findIdentity(provider, identity.subject);
    if (known && known.userId !== userId) throw AppException.conflict('SSO_IDENTITY_IN_USE');
    if (known) {
      await this.touch(known.id, identity.email);
      return;
    }

    await this.connect(
      user,
      { provider, subject: identity.subject, email: identity.email },
      // The provider proved this very address is theirs: as good as the link we mail.
      { emailProven: identity.emailTrusted && identity.email === user.email },
    );
  }

  /**
   * Signing in through a workspace's identity provider. The person it has
   * already been connected to, while they are still in the workspace; else,
   * when the workspace has verified the address's domain, the account with
   * that address or a new one, made a member. Anyone else is turned away:
   * the provider speaks only for its own domains. So is an account the
   * workspace removed, or that left: CoreTask decided about them, and only
   * an invitation brings them back.
   */
  async signInWithSaml(
    connection: SamlConnection,
    assertion: SamlAssertion,
    retry = true,
  ): Promise<User> {
    const subject = samlSubject(connection, assertion);
    const known = await this.findIdentity(IdentityProvider.SAML, subject);
    if (known) {
      assertCanSignIn(known.user);
      if (!(await this.members.findMembership(connection.workspaceId, known.userId))) {
        throw AppException.forbidden('SSO_ACCOUNT_NOT_FOUND');
      }
      await this.touch(known.id, assertion.email);
      return known.user;
    }

    const email = assertion.email;
    if (!email || !(await this.domainVerified(connection.workspaceId, email))) {
      throw AppException.forbidden('SSO_ACCOUNT_NOT_FOUND');
    }

    const input: IdentityInput = {
      provider: IdentityProvider.SAML,
      subject,
      email,
      samlConnectionId: connection.id,
      signingIn: true,
    };
    try {
      const existing = await this.users.findByEmail(email);
      if (existing) {
        assertCanClaimByAddress(existing, await this.connections(existing.id));
        const member = await this.members.findMembership(connection.workspaceId, existing.id);
        // Someone the workspace let go reaches this point when the identity
        // check above never saw them: they had not signed in with this
        // provider, or disconnected it. Turned away before anything is connected.
        if (!member && (await this.departed(connection.workspaceId, existing.id))) {
          throw AppException.forbidden('SSO_ACCOUNT_NOT_FOUND');
        }
        const user = await this.connect(existing, input, { emailProven: true });
        if (!member) {
          await this.members.addMember({
            workspaceId: connection.workspaceId,
            userId: user.id,
            role: WorkspaceRole.MEMBER,
          });
          await this.recordJoined(connection.workspaceId, user);
        }
        return user;
      }

      // The account, its connection and its membership together: an account
      // made here but left outside the workspace could never sign in again.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await this.users.create(
          {
            email,
            name: personName(assertion) ?? localPart(email),
            passwordHash: null,
            emailVerifiedAt: new Date(),
          },
          tx,
        );
        await tx.userIdentity.create({ data: identityData(created.id, input) });
        await this.members.addMember(
          { workspaceId: connection.workspaceId, userId: created.id, role: WorkspaceRole.MEMBER },
          tx,
        );
        return created;
      });
      this.logger.log(
        { userId: user.id, workspaceId: connection.workspaceId },
        'Created an account by SAML',
      );
      await this.recordJoined(connection.workspaceId, user);
      return user;
    } catch (error) {
      if (retry && isUniqueViolation(error)) {
        return this.signInWithSaml(connection, assertion, false);
      }
      throw error;
    }
  }

  /** Connecting a workspace's identity provider from Settings: members only, one per workspace. */
  async linkSaml(
    userId: string,
    connection: SamlConnection,
    assertion: SamlAssertion,
  ): Promise<void> {
    const user = await this.users.requireById(userId);
    assertCanSignIn(user);
    if (!(await this.members.findMembership(connection.workspaceId, userId))) {
      throw AppException.forbidden('WORKSPACE_ACCESS_DENIED');
    }

    const subject = samlSubject(connection, assertion);
    const known = await this.findIdentity(IdentityProvider.SAML, subject);
    if (known && known.userId !== userId) throw AppException.conflict('SSO_IDENTITY_IN_USE');
    if (known) {
      await this.touch(known.id, assertion.email);
      return;
    }

    await this.connect(
      user,
      {
        provider: IdentityProvider.SAML,
        subject,
        email: assertion.email ?? assertion.nameId.slice(0, 254),
        samlConnectionId: connection.id,
      },
      { emailProven: false },
    );
  }

  async listIdentities(userId: string): Promise<LinkedIdentity[]> {
    const identities = await this.prisma.userIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        samlConnection: { select: { workspace: { select: { id: true, name: true } } } },
      },
    });
    return identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      email: identity.email,
      workspace: identity.samlConnection?.workspace ?? null,
      createdAt: identity.createdAt.toISOString(),
      lastUsedAt: identity.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Disconnects one. Refused when it is the only way the account has in:
   * no password, and nothing else connected. The account row is locked
   * while it counts, so two disconnects at once cannot both pass.
   */
  async unlink(userId: string, identityId: string): Promise<void> {
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const identity = await tx.userIdentity.findFirst({
        where: { id: identityId, userId },
        include: { samlConnection: { select: { workspace: { select: { name: true } } } } },
      });
      if (!identity) {
        throw AppException.notFound('RESOURCE_NOT_FOUND', 'That account is not connected.');
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user.passwordHash && (await tx.userIdentity.count({ where: { userId } })) <= 1) {
        throw AppException.conflict('SSO_LAST_SIGN_IN_METHOD');
      }
      await tx.userIdentity.delete({ where: { id: identity.id } });
      return identity;
    });

    this.logger.log({ userId, provider: removed.provider }, 'Disconnected a sign-in');
    const label = describe(removed.provider, removed.samlConnection?.workspace.name);
    await this.notices.send(userId, {
      subject: `${label} is disconnected from your CoreTask account`,
      heading: `${label} disconnected`,
      lines: [
        `Signing in to CoreTask with ${label} (${removed.email}) no longer works.`,
        'If this was not you, change your password and sign out your other sessions in Settings.',
      ],
    });
  }

  // -------------------------------------------------------------------------

  /** The identity and its account; one whose account was deleted is forgotten, as the account was. */
  private async findIdentity(provider: IdentityProvider, subject: string) {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      include: { user: true },
    });
    if (identity?.user.deletedAt) {
      await this.prisma.userIdentity.delete({ where: { id: identity.id } }).catch(() => undefined);
      return null;
    }
    return identity;
  }

  /** How many outside sign-ins the account has connected. */
  private connections(userId: string): Promise<number> {
    return this.prisma.userIdentity.count({ where: { userId } });
  }

  /** At each sign-in: when it was used, and the address the provider has for them now. */
  private async touch(identityId: string, email: string | null): Promise<void> {
    await this.prisma.userIdentity.update({
      where: { id: identityId },
      data: { lastUsedAt: new Date(), ...(email ? { email } : {}) },
    });
  }

  /**
   * Writes the connection, replacing the account's previous one from the
   * same provider (or, for SAML, the same workspace), and says so by e-mail:
   * a new way into an account is something its owner should hear about.
   */
  private async connect(
    user: User,
    input: IdentityInput,
    options: { emailProven: boolean },
  ): Promise<User> {
    const [, , updated] = await this.prisma.$transaction([
      this.prisma.userIdentity.deleteMany({
        where: {
          userId: user.id,
          provider: input.provider,
          ...(input.samlConnectionId ? { samlConnectionId: input.samlConnectionId } : {}),
        },
      }),
      this.prisma.userIdentity.create({ data: identityData(user.id, input) }),
      // The provider checked the address, which is what our confirmation link proves.
      options.emailProven && !user.emailVerifiedAt
        ? this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
          })
        : this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ]);

    const label = describe(input.provider, await this.workspaceName(input.samlConnectionId));
    await this.notices.send(user.id, {
      subject: `${label} is connected to your CoreTask account`,
      heading: `${label} connected`,
      lines: [
        `You can now sign in to CoreTask with ${label} (${input.email}).`,
        'If this was not you, disconnect it in Settings and change your password.',
      ],
    });
    return updated;
  }

  private async workspaceName(samlConnectionId: string | undefined): Promise<string | undefined> {
    if (!samlConnectionId) return undefined;
    const connection = await this.prisma.samlConnection.findUnique({
      where: { id: samlConnectionId },
      select: { workspace: { select: { name: true } } },
    });
    return connection?.workspace.name;
  }

  private async domainVerified(workspaceId: string, email: string): Promise<boolean> {
    const domain = email.split('@').at(-1);
    if (!domain) return false;
    const claimed = await this.prisma.workspaceDomain.findFirst({
      where: { workspaceId, domain, verifiedAt: { not: null } },
      select: { id: true },
    });
    return claimed !== null;
  }

  /** Whether the workspace ever removed them, or they left it. */
  private async departed(workspaceId: string, userId: string): Promise<boolean> {
    const departure = await this.prisma.workspaceDeparture.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    });
    return departure !== null;
  }

  /** The provider vouches for them, so they are in: as a member, like an accepted invitation. */
  private async recordJoined(workspaceId: string, user: User): Promise<void> {
    await this.activity.record({
      workspaceId,
      actorId: user.id,
      action: ActivityAction.MEMBER_ADDED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: user.id,
      summary: `${user.email} joined through single sign-on`,
      metadata: { role: WorkspaceRole.MEMBER, via: 'saml' },
      projectId: null,
    });
  }
}

/**
 * Before an account is handed to whoever the provider vouches for by address:
 * its own address must have been confirmed. Anyone can register someone
 * else's address and set a password, then wait for its owner to arrive by
 * SSO and share the account with them ("pre-hijacking"). Confirming the
 * address — the e-mailed link, or a reset link, which also signs out every
 * session — is what makes the account its owner's.
 *
 * Except an account nobody can get into: no password and nothing connected,
 * as an import makes for someone who has not signed up yet. There is no way
 * in for anyone to have kept, so handing it over is the same as making its
 * owner a new account, with the work already assigned to them in it.
 */
function assertCanClaimByAddress(user: User, connections: number): void {
  assertCanSignIn(user);
  if (user.emailVerifiedAt) return;
  if (!user.passwordHash && connections === 0) return;
  throw AppException.forbidden('SSO_ACCOUNT_UNCONFIRMED');
}

/** Deleted and service accounts are no one to sign in as; a disabled one says so. */
function assertCanSignIn(user: User): void {
  if (user.deletedAt || user.isServiceAccount) {
    throw AppException.forbidden('SSO_ACCOUNT_NOT_FOUND');
  }
  if (!user.isActive) throw AppException.forbidden('ACCOUNT_DISABLED');
}

function identityData(
  userId: string,
  input: IdentityInput,
): Prisma.UserIdentityUncheckedCreateInput {
  return {
    userId,
    provider: input.provider,
    subject: input.subject,
    email: input.email,
    samlConnectionId: input.samlConnectionId ?? null,
    lastUsedAt: input.signingIn ? new Date() : null,
  };
}

/** NameIDs are unique per identity provider, so the connection's id keeps them apart. */
function samlSubject(connection: SamlConnection, assertion: SamlAssertion): string {
  return `${connection.id}:${assertion.nameId}`;
}

function personName(assertion: SamlAssertion): string | null {
  const name = [assertion.firstName, assertion.lastName].filter(Boolean).join(' ').trim();
  return name ? name.slice(0, 120) : null;
}

/** `ada.lovelace@example.com` → `ada.lovelace`: a name to start with, editable in Settings. */
function localPart(email: string): string {
  return (email.split('@')[0] ?? email).slice(0, 120) || email.slice(0, 120);
}

function describe(provider: IdentityProvider, workspaceName: string | undefined): string {
  return provider === IdentityProvider.SAML && workspaceName
    ? `${workspaceName}’s single sign-on`
    : PROVIDER_LABELS[provider];
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

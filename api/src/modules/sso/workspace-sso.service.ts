import { randomBytes, X509Certificate } from 'node:crypto';

import {
  ActivityAction,
  ActivityEntity,
  DOMAIN_VERIFICATION_PREFIX,
  WORKSPACE_DOMAIN_LIMIT,
} from '@coretask/contracts';
import type {
  AddWorkspaceDomainPayload,
  SamlConnection as SamlConnectionDto,
  UpsertSamlConnectionPayload,
  WorkspaceDomain as WorkspaceDomainDto,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type SamlConnection, type WorkspaceDomain } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import { DomainTxtResolver } from './domain-txt-resolver';
import { normalizeCertificate } from './lib/saml';
import { SamlService } from './saml.service';

/**
 * A workspace's single sign-on, as its admins set it up: the SAML identity
 * provider, and the e-mail domains the workspace proves it owns with a DNS
 * TXT record. A verified domain is what lets the provider sign in, and
 * create, accounts at that domain; without one it speaks only for people
 * who connected it to their account themselves.
 */
@Injectable()
export class WorkspaceSsoService {
  private readonly logger = new Logger(WorkspaceSsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saml: SamlService,
    private readonly activity: ActivityLogsService,
    private readonly dns: DomainTxtResolver,
  ) {}

  async getConnection(workspaceId: string): Promise<SamlConnectionDto | null> {
    const connection = await this.prisma.samlConnection.findUnique({ where: { workspaceId } });
    return connection ? this.toConnection(connection) : null;
  }

  async upsertConnection(
    workspaceId: string,
    actorId: string,
    input: UpsertSamlConnectionPayload,
  ): Promise<SamlConnectionDto> {
    // Empty only in a draft that is switched off; the schema sees to that.
    const idpCertificate = input.idpCertificate ? normalizeCertificate(input.idpCertificate) : '';
    // Read now, so a certificate that cannot be used is refused here rather
    // than at somebody's first sign-in.
    if (idpCertificate) {
      try {
        new X509Certificate(idpCertificate);
      } catch {
        throw AppException.unprocessable(
          'VALIDATION_FAILED',
          'That certificate could not be read. Paste it again, including its BEGIN and END lines.',
          { issues: [{ path: 'idpCertificate', message: 'The certificate could not be read.' }] },
        );
      }
    }

    const data = {
      idpEntityId: input.idpEntityId,
      idpSsoUrl: input.idpSsoUrl,
      idpCertificate,
      enabled: input.enabled,
    };
    const existing = await this.prisma.samlConnection.findUnique({
      where: { workspaceId },
      select: { id: true },
    });
    const connection = await this.prisma.samlConnection.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: existing ? ActivityAction.UPDATED : ActivityAction.CREATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: existing
        ? `Updated single sign-on (${connection.enabled ? 'on' : 'off'})`
        : `Set up single sign-on (${connection.enabled ? 'on' : 'off'})`,
      metadata: { idpEntityId: connection.idpEntityId, enabled: connection.enabled },
      projectId: null,
    });
    this.logger.log({ workspaceId, enabled: connection.enabled }, 'SAML connection saved');
    return this.toConnection(connection);
  }

  /** Everyone's connection to it goes too; their accounts stay, with whatever other ways in they have. */
  async deleteConnection(workspaceId: string, actorId: string): Promise<void> {
    const { count } = await this.prisma.samlConnection.deleteMany({ where: { workspaceId } });
    if (count === 0) throw AppException.notFound('SAML_NOT_CONFIGURED');

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: 'Removed single sign-on',
      projectId: null,
    });
  }

  async listDomains(workspaceId: string): Promise<WorkspaceDomainDto[]> {
    const domains = await this.prisma.workspaceDomain.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return domains.map(toDomain);
  }

  async addDomain(
    workspaceId: string,
    actorId: string,
    input: AddWorkspaceDomainPayload,
  ): Promise<WorkspaceDomainDto> {
    const count = await this.prisma.workspaceDomain.count({ where: { workspaceId } });
    if (count >= WORKSPACE_DOMAIN_LIMIT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A workspace can have up to ${WORKSPACE_DOMAIN_LIMIT} domains.`,
      );
    }

    const duplicate = await this.prisma.workspaceDomain.findUnique({
      where: { workspaceId_domain: { workspaceId, domain: input.domain } },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'That domain is already on the list.');
    }

    let domain: WorkspaceDomain;
    try {
      domain = await this.prisma.workspaceDomain.create({
        data: {
          workspaceId,
          domain: input.domain,
          verificationToken: randomBytes(16).toString('hex'),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('RESOURCE_CONFLICT', 'That domain is already on the list.');
      }
      throw error;
    }

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Added the domain ${domain.domain}`,
      metadata: { domainId: domain.id, domain: domain.domain },
      projectId: null,
    });
    return toDomain(domain);
  }

  async removeDomain(workspaceId: string, domainId: string, actorId: string): Promise<void> {
    const domain = await this.requireDomain(workspaceId, domainId);
    await this.prisma.workspaceDomain.delete({ where: { id: domain.id } });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Removed the domain ${domain.domain}`,
      metadata: { domainId: domain.id, domain: domain.domain },
      projectId: null,
    });
  }

  /**
   * Looks for the TXT record. A domain can be verified by one workspace
   * only — whichever proves it first — because a verified domain lets the
   * workspace's provider create accounts there.
   */
  async verifyDomain(
    workspaceId: string,
    domainId: string,
    actorId: string,
  ): Promise<WorkspaceDomainDto> {
    const domain = await this.requireDomain(workspaceId, domainId);
    if (domain.verifiedAt) return toDomain(domain);

    const elsewhere = await this.prisma.workspaceDomain.findFirst({
      where: {
        domain: domain.domain,
        verifiedAt: { not: null },
        workspaceId: { not: workspaceId },
      },
      select: { id: true },
    });
    if (elsewhere) throw AppException.conflict('DOMAIN_ALREADY_VERIFIED');

    const expected = `${DOMAIN_VERIFICATION_PREFIX}${domain.verificationToken}`;
    let records: string[][];
    try {
      records = await this.dns.resolveTxt(domain.domain);
    } catch (error) {
      // ENODATA and ENOTFOUND are the usual answers before the record exists.
      this.logger.log(
        { workspaceId, domain: domain.domain, err: (error as NodeJS.ErrnoException).code },
        'No TXT records for the domain',
      );
      throw AppException.badRequest('DOMAIN_VERIFICATION_FAILED');
    }
    // DNS splits a long record into 255-byte chunks; joined, it is the value as published.
    if (!records.some((chunks) => chunks.join('').trim() === expected)) {
      throw AppException.badRequest('DOMAIN_VERIFICATION_FAILED');
    }

    const verified = await this.prisma.workspaceDomain.update({
      where: { id: domain.id },
      data: { verifiedAt: new Date() },
    });
    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Verified the domain ${domain.domain}`,
      metadata: { domainId: domain.id, domain: domain.domain },
      projectId: null,
    });
    this.logger.log({ workspaceId, domain: domain.domain }, 'Domain verified');
    return toDomain(verified);
  }

  private async requireDomain(workspaceId: string, domainId: string): Promise<WorkspaceDomain> {
    const domain = await this.prisma.workspaceDomain.findFirst({
      where: { id: domainId, workspaceId },
    });
    if (!domain)
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'That domain is not on the list.');
    return domain;
  }

  private toConnection(connection: SamlConnection): SamlConnectionDto {
    return {
      id: connection.id,
      enabled: connection.enabled,
      idpEntityId: connection.idpEntityId,
      idpSsoUrl: connection.idpSsoUrl,
      idpCertificate: connection.idpCertificate,
      serviceProvider: this.saml.serviceProvider(connection.id),
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }
}

function toDomain(domain: WorkspaceDomain): WorkspaceDomainDto {
  return {
    id: domain.id,
    domain: domain.domain,
    verified: domain.verifiedAt !== null,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    txtRecord: `${DOMAIN_VERIFICATION_PREFIX}${domain.verificationToken}`,
    createdAt: domain.createdAt.toISOString(),
  };
}

import { randomBytes } from 'node:crypto';

import { SignInMethod } from '@coretask/contracts';
import type { SsoRedirect } from '@coretask/types';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { AUTH_THROTTLE } from '../../config/throttle.config';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { sanitizeRedirect } from './lib/redirect';
import { SamlService } from './saml.service';
import { SsoAccountsService } from './sso-accounts.service';
import { SsoResponder } from './sso-responder';

/**
 * Signing in through a workspace's own identity provider.
 *
 * The provider posts its response to the ACS from its own site, and a
 * SameSite=Lax cookie does not travel on a cross-site POST. So the ACS only
 * checks the response and seals the verdict into a 303 to `finish`: a
 * top-level GET, which does carry the cookie, and where the verdict is
 * matched to the browser that started the sign-in.
 *
 * Registered ahead of `SsoController`, whose `:provider/start` would
 * otherwise also match `saml/start`.
 */
@ApiTags('Authentication')
@Controller('auth/sso/saml')
@SessionOnly()
@AllowUnverifiedEmail()
export class SamlController {
  constructor(
    private readonly saml: SamlService,
    private readonly accounts: SsoAccountsService,
    private readonly responder: SsoResponder,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Get('start')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Sign in with a workspace’s SAML provider (navigate here)',
    description:
      '`?workspace=<slug>`, or `?email=<address>` for the workspace that verified its domain; `redirect` is the path to land on. Without an enabled connection, redirects to the web app’s `/sso?error=SAML_NOT_CONFIGURED`.',
  })
  async start(
    @Query('workspace') workspace: unknown,
    @Query('email') email: unknown,
    @Query('redirect') redirect: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const connection = await this.saml.findForSignIn({ workspace, email });
    if (!connection) {
      response.redirect(302, `${this.responder.webUrl}/sso?error=SAML_NOT_CONFIGURED`);
      return;
    }
    const relayState = randomBytes(24).toString('base64url');
    const url = await this.saml.authorizeUrl(connection, relayState);
    this.responder.remember(response, {
      kind: 'saml',
      connectionId: connection.id,
      relayState,
      mode: 'login',
      redirect: sanitizeRedirect(redirect),
    });
    response.redirect(302, url);
  }

  @Post('link/:workspaceId')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @UseGuards(WorkspaceMemberGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'workspaceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Connect a workspace’s SAML provider to your account',
    description:
      'Answers the identity provider’s address to send the browser to. It comes back to Settings with `?ssoLinked=saml` or `?ssoError=<code>`.',
  })
  @ApiErrorResponseDoc(404, 'The workspace has no enabled SAML connection')
  async link(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SsoRedirect> {
    const connection = await this.saml.enabledForWorkspace(workspaceId);
    const relayState = randomBytes(24).toString('base64url');
    const url = await this.saml.authorizeUrl(connection, relayState);
    this.responder.remember(response, {
      kind: 'saml',
      connectionId: connection.id,
      relayState,
      mode: 'link',
      userId,
      redirect: '/settings',
    });
    return { url };
  }

  @Public()
  @Get('finish')
  @SkipThrottle()
  @ApiExcludeEndpoint()
  async finish(
    @Query('result') sealed: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const state = this.responder.takeState(request, response);
    const mode = state?.mode ?? 'login';

    try {
      const result = this.saml.openResult(sealed);
      if (
        !result ||
        !state ||
        state.kind !== 'saml' ||
        state.connectionId !== result.connectionId ||
        state.relayState !== result.relayState
      ) {
        throw AppException.badRequest('SSO_FAILED');
      }
      if ('error' in result) throw AppException.badRequest(result.error);

      const connection = await this.saml.requireEnabled(result.connectionId);

      if (state.mode === 'link') {
        if (!state.userId) throw AppException.badRequest('SSO_FAILED');
        await this.accounts.linkSaml(state.userId, connection, result.assertion);
        this.responder.linked(response, 'saml');
        return;
      }

      const user = await this.accounts.signInWithSaml(connection, result.assertion);
      await this.responder.signIn(request, response, user, SignInMethod.SAML, state.redirect);
    } catch (error) {
      this.responder.fail(response, mode, error);
    }
  }

  @Public()
  @Post(':connectionId/acs')
  @Throttle(AUTH_THROTTLE)
  @ApiExcludeEndpoint()
  @ApiConsumes('application/x-www-form-urlencoded')
  async acs(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sealed = await this.saml.consume(connectionId, body);
    // 303, so the browser follows with a GET whatever method brought it here.
    response.redirect(
      303,
      `${this.config.sso.apiBase}/auth/sso/saml/finish?result=${encodeURIComponent(sealed)}`,
    );
  }

  @Public()
  @Get(':connectionId/metadata')
  @ApiOperation({
    summary: 'The service provider metadata to give the identity provider',
    description: 'Its own address is also the entity ID.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiProduces('application/samlmetadata+xml')
  @ApiErrorResponseDoc(404, 'No such connection')
  async metadata(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Res() response: Response,
  ): Promise<void> {
    const xml = await this.saml.metadata(connectionId);
    response.type('application/samlmetadata+xml').send(xml);
  }
}

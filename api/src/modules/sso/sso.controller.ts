import { SignInMethod, type SocialSsoProvider } from '@coretask/contracts';
import type { LinkedIdentity, SsoProviders, SsoRedirect } from '@coretask/types';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
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
import { AUTH_THROTTLE } from '../../config/throttle.config';

import { parseSocialProvider } from './lib/oidc';
import { sanitizeRedirect } from './lib/redirect';
import { OidcService } from './oidc.service';
import { SsoAccountsService } from './sso-accounts.service';
import { SsoResponder } from './sso-responder';

const SIGN_IN_METHODS: Record<SocialSsoProvider, SignInMethod> = {
  google: SignInMethod.GOOGLE,
  microsoft: SignInMethod.MICROSOFT,
};

/**
 * Signing in with Google and Microsoft, and the outside accounts connected
 * to the caller's. `start` and `callback` are navigated to, not fetched:
 * they answer with redirects, and every failure is a redirect back to the
 * web app with an error code.
 */
@ApiTags('Authentication')
@Controller('auth/sso')
@SessionOnly()
@AllowUnverifiedEmail()
export class SsoController {
  constructor(
    private readonly oidc: OidcService,
    private readonly accounts: SsoAccountsService,
    private readonly responder: SsoResponder,
  ) {}

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Which ways to sign in this server offers' })
  providers(): SsoProviders {
    return this.accounts.providers();
  }

  @Get('identities')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The Google, Microsoft and SAML accounts connected to yours' })
  @ApiErrorResponseDoc(401, 'Missing or invalid access token')
  identities(@CurrentUser('id') userId: string): Promise<LinkedIdentity[]> {
    return this.accounts.listIdentities(userId);
  }

  @Delete('identities/:identityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Disconnect an account',
    description:
      'Refused with SSO_LAST_SIGN_IN_METHOD when the account has no password and this is the only one connected.',
  })
  @ApiParam({ name: 'identityId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'Not connected to your account')
  @ApiErrorResponseDoc(409, 'It is the only way the account can sign in')
  async unlink(
    @CurrentUser('id') userId: string,
    @Param('identityId', ParseUUIDPipe) identityId: string,
  ): Promise<void> {
    await this.accounts.unlink(userId, identityId);
  }

  @Public()
  @Get(':provider/start')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Sign in with Google or Microsoft (navigate here)',
    description:
      'Redirects to the provider. `redirect` is the web app path to land on afterwards. Ends at the web app’s `/sso/complete`, or `/login?ssoError=<code>`.',
  })
  @ApiParam({ name: 'provider', enum: ['google', 'microsoft'] })
  start(
    @Param('provider') rawProvider: string,
    @Query('redirect') redirect: unknown,
    @Res() response: Response,
  ): void {
    const provider = parseSocialProvider(rawProvider);
    if (!provider || !this.oidc.configured(provider)) {
      this.responder.fail(response, 'login', AppException.notFound('SSO_NOT_CONFIGURED'));
      return;
    }
    const { url, state } = this.oidc.begin(provider, {
      mode: 'login',
      redirect: sanitizeRedirect(redirect),
    });
    this.responder.remember(response, state);
    response.redirect(302, url);
  }

  @Post(':provider/link')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Connect Google or Microsoft to your account',
    description:
      'Answers the provider’s address to send the browser to. It comes back to Settings with `?ssoLinked=<provider>` or `?ssoError=<code>`.',
  })
  @ApiParam({ name: 'provider', enum: ['google', 'microsoft'] })
  @ApiErrorResponseDoc(404, 'This server does not offer that provider')
  link(
    @Param('provider') rawProvider: string,
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): SsoRedirect {
    const provider = parseSocialProvider(rawProvider);
    if (!provider) throw AppException.notFound('SSO_NOT_CONFIGURED');
    const { url, state } = this.oidc.begin(provider, {
      mode: 'link',
      userId,
      redirect: '/settings',
    });
    this.responder.remember(response, state);
    return { url };
  }

  @Public()
  @Get(':provider/callback')
  @SkipThrottle()
  @ApiExcludeEndpoint()
  async callback(
    @Param('provider') rawProvider: string,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const state = this.responder.takeState(request, response);
    const mode = state?.mode ?? 'login';

    try {
      const provider = parseSocialProvider(rawProvider);
      if (!provider || !this.oidc.configured(provider))
        throw AppException.notFound('SSO_NOT_CONFIGURED');
      // Only the browser that started this sign-in holds the cookie, and the
      // state in it must be the one the provider echoed back: that is what
      // stops someone else's code being slipped into this browser.
      if (
        !state ||
        state.kind !== 'oidc' ||
        state.provider !== provider ||
        query['state'] !== state.state
      ) {
        throw AppException.badRequest('SSO_FAILED');
      }
      // The person cancelled, or the provider refused (`error=access_denied`).
      if (typeof query['error'] === 'string' || typeof query['code'] !== 'string') {
        throw AppException.badRequest('SSO_FAILED');
      }

      const identity = await this.oidc.complete(provider, query['code'], state);

      if (state.mode === 'link') {
        if (!state.userId) throw AppException.badRequest('SSO_FAILED');
        await this.accounts.linkSocial(state.userId, provider, identity);
        this.responder.linked(response, provider);
        return;
      }

      const user = await this.accounts.signInWithSocial(provider, identity);
      await this.responder.signIn(
        request,
        response,
        user,
        SIGN_IN_METHODS[provider],
        state.redirect,
      );
    } catch (error) {
      this.responder.fail(response, mode, error);
    }
  }
}

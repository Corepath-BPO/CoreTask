import type { OAuthConsent, OAuthRedirect } from '@coretask/types';
import { oauthAuthorizationSchema, oauthDecisionSchema } from '@coretask/validation';
import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { parseBody } from '../../common/utils/zod-body.util';
import { AUTH_THROTTLE } from '../../config/throttle.config';

import { OAuthConsentDto, OAuthRedirectDto, OAuthTokenResponseDto } from './dto/oauth.dto';
import { readBasicClient } from './lib/oauth-token';
import {
  OAuthProtocolError,
  OAuthService,
  type ClientCredentials,
  type TokenRequest,
} from './oauth.service';

/**
 * The authorization server.
 *
 * Two halves. Consent is the person's: the web app's `/oauth/authorize` page
 * asks `consent` what to show and posts the answer to `authorize`, both with
 * the person's session — an app or a key may never approve an app. Tokens are
 * the tool's: `token` and `revoke` take the client's own credentials, speak
 * RFC 6749 and RFC 7009 rather than CoreTask's envelope, and are public.
 */
@ApiTags('Integrations')
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Post('consent')
  @SessionOnly()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check an authorization request and describe it',
    description:
      'For the consent page. Answers 400 when the app is unknown or the redirect URI is not one it registered — the page shows that rather than redirecting anywhere.',
  })
  @ApiEnvelopeResponse(OAuthConsentDto)
  @ApiErrorResponseDoc(400, 'Unknown app, unregistered redirect URI or unsupported request')
  consent(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<OAuthConsent> {
    const input = parseBody(
      oauthAuthorizationSchema,
      body,
      'The authorization request is invalid.',
    );
    return this.oauth.consent(userId, input);
  }

  @Post('authorize')
  @SessionOnly()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Allow or refuse an app',
    description:
      'Answers the URL the browser goes to next: the redirect URI with `code` and `state`, or with `error=access_denied`.',
  })
  @ApiEnvelopeResponse(OAuthRedirectDto)
  @ApiErrorResponseDoc(400, 'Unknown app, unregistered redirect URI or unsupported request')
  authorize(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<OAuthRedirect> {
    const input = parseBody(oauthDecisionSchema, body, 'The authorization request is invalid.');
    return this.oauth.authorize(userId, input);
  }

  @Post('token')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiOperation({
    summary: 'Exchange a code or a refresh token for an access token',
    description:
      'RFC 6749. `grant_type=authorization_code` with `code`, `redirect_uri` and, when a challenge was sent, `code_verifier`; or `grant_type=refresh_token` with `refresh_token`. The client authenticates with `client_id` and `client_secret` in the body or HTTP Basic. Answers unwrapped; errors are `{ error, error_description }`.',
  })
  @ApiResponse({ status: 200, type: OAuthTokenResponseDto })
  async token(@Req() request: Request, @Res() response: Response): Promise<void> {
    const body = (request.body ?? {}) as TokenRequest;
    await this.answer(response, () => this.oauth.token(clientOf(request, body), body));
  }

  @Post('revoke')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiOperation({
    summary: 'Revoke a refresh token or an access token',
    description:
      'RFC 7009. A refresh token disconnects the app and deletes the webhooks it subscribed; an access token ends just that token. Answers 200 for a token CoreTask does not recognise, too.',
  })
  @ApiResponse({ status: 200 })
  async revoke(@Req() request: Request, @Res() response: Response): Promise<void> {
    const body = (request.body ?? {}) as TokenRequest & { token?: unknown };
    await this.answer(response, async () => {
      await this.oauth.revoke(clientOf(request, body), body);
      return {};
    });
  }

  /** The RFC's shapes, and no caching of anything that holds a token. */
  private async answer(response: Response, run: () => Promise<object>): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    try {
      response.status(HttpStatus.OK).json(await run());
    } catch (error) {
      if (!(error instanceof OAuthProtocolError)) throw error;
      if (error.status === 401) response.setHeader('WWW-Authenticate', 'Basic realm="CoreTask"');
      response
        .status(error.status)
        .json({ error: error.error, error_description: error.description });
    }
  }
}

/**
 * `client_secret_basic` when the header is there, `client_secret_post`
 * otherwise — or the id alone (`none`), which only a public client may use.
 */
function clientOf(request: Request, body: TokenRequest): ClientCredentials | null {
  const basic = readBasicClient(request.headers);
  if (basic) return { clientId: basic.clientId, clientSecret: basic.clientSecret || null };
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
  const clientSecret = typeof body.client_secret === 'string' ? body.client_secret.trim() : '';
  return clientId ? { clientId, clientSecret: clientSecret || null } : null;
}

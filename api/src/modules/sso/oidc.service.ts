import type { SocialSsoProvider } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { fetchWithTimeout, safeBody } from '../../common/utils/http.util';
import { AppConfigService } from '../../config/app-config.service';

import {
  createPkcePair,
  decodeIdToken,
  IdTokenError,
  type IdTokenExpectations,
  randomToken,
  validateIdTokenClaims,
  type VerifiedIdentity,
} from './lib/oidc';
import type { OidcState, SsoMode } from './lib/sso-state';

const PROVIDER_NAMES: Record<SocialSsoProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

/**
 * "Sign in with Google" and "Sign in with Microsoft": OpenID Connect's
 * authorization code flow, with PKCE, a nonce and a state, all three kept in
 * the browser's encrypted cookie until the provider sends it back.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(private readonly config: AppConfigService) {}

  configured(provider: SocialSsoProvider): boolean {
    return this.config.sso[provider].enabled;
  }

  /** The provider's sign-in page, and what the browser has to keep until it comes back. */
  begin(
    provider: SocialSsoProvider,
    flow: { mode: SsoMode; userId?: string; redirect: string },
  ): { url: string; state: OidcState } {
    const settings = this.config.sso[provider];
    if (!settings.enabled || !settings.clientId) {
      throw AppException.notFound('SSO_NOT_CONFIGURED');
    }

    const pkce = createPkcePair();
    const state: OidcState = {
      kind: 'oidc',
      provider,
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: pkce.verifier,
      mode: flow.mode,
      redirect: flow.redirect,
      ...(flow.userId ? { userId: flow.userId } : {}),
    };

    const url = new URL(settings.authorizeUrl);
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', settings.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state.state);
    url.searchParams.set('nonce', state.nonce);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Someone signed in to several accounts gets to choose, rather than being
    // signed in silently as whichever the provider last used.
    url.searchParams.set('prompt', 'select_account');

    return { url: url.toString(), state };
  }

  /**
   * The code the provider sent back, exchanged for an ID token, and the
   * token checked.
   *
   * The token's signature is deliberately not verified. OpenID Connect Core
   * 3.1.3.7 (step 6) allows that for an ID token received directly from the
   * token endpoint over TLS, as this one is: the server CoreTask
   * authenticated to with its client secret is the one that answered, so
   * there is nobody in between to forge it. Every claim is still checked.
   */
  async complete(
    provider: SocialSsoProvider,
    code: string,
    state: OidcState,
  ): Promise<VerifiedIdentity> {
    const idToken = await this.exchange(provider, code, state.codeVerifier);
    try {
      return validateIdTokenClaims(
        decodeIdToken(idToken),
        this.expectations(provider, state.nonce),
      );
    } catch (error) {
      if (error instanceof IdTokenError) {
        this.logger.warn({ provider, reason: error.message }, 'Refused an ID token');
        throw AppException.badRequest('SSO_FAILED');
      }
      throw error;
    }
  }

  private expectations(provider: SocialSsoProvider, nonce: string): IdTokenExpectations {
    const { google, microsoft } = this.config.sso;
    return provider === 'google'
      ? { provider, clientId: google.clientId ?? '', nonce, issuer: google.issuer }
      : {
          provider,
          clientId: microsoft.clientId ?? '',
          nonce,
          loginUrl: microsoft.loginUrl,
          tenant: microsoft.tenant,
        };
  }

  /** `client_secret_post`, with the PKCE verifier: the provider checks both. */
  private async exchange(
    provider: SocialSsoProvider,
    code: string,
    verifier: string,
  ): Promise<unknown> {
    const settings = this.config.sso[provider];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: settings.redirectUri,
      client_id: settings.clientId ?? '',
      client_secret: settings.clientSecret ?? '',
      code_verifier: verifier,
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        settings.tokenUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: body.toString(),
          redirect: 'error',
        },
        this.config.sso.timeoutMs,
        PROVIDER_NAMES[provider],
      );
    } catch (error) {
      this.logger.warn(
        { provider, err: error instanceof Error ? error.message : String(error) },
        'The sign-in provider could not be reached',
      );
      throw AppException.badRequest('SSO_FAILED');
    }

    if (!response.ok) {
      // invalid_grant (a code used twice, or expired) lands here too.
      this.logger.warn(
        { provider, status: response.status, body: await safeBody(response) },
        'The sign-in provider refused the code',
      );
      throw AppException.badRequest('SSO_FAILED');
    }

    try {
      const tokens = (await response.json()) as { id_token?: unknown };
      return tokens.id_token;
    } catch {
      this.logger.warn({ provider }, 'The sign-in provider answered something other than JSON');
      throw AppException.badRequest('SSO_FAILED');
    }
  }
}

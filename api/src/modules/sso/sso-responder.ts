import type { ErrorCode, SignInMethod } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { AuthService } from '../auth/auth.service';
import { completeSession, isTwoFactorChallenge, sessionContext } from '../auth/lib/session-http';
import { deriveKey } from '../webhooks/lib/secret-cipher';

import {
  openSsoState,
  sealSsoState,
  SSO_COOKIE,
  ssoClearCookieOptions,
  ssoCookieOptions,
  type SsoMode,
  type SsoState,
} from './lib/sso-state';

/** The codes worth showing the person; anything else is "it did not finish". */
const SHOWN_CODES = new Set<ErrorCode>([
  'SSO_NOT_CONFIGURED',
  'SSO_FAILED',
  'SSO_EMAIL_UNVERIFIED',
  'SSO_ACCOUNT_NOT_FOUND',
  'SSO_ACCOUNT_UNCONFIRMED',
  'SSO_IDENTITY_IN_USE',
  'SAML_NOT_CONFIGURED',
  'ACCOUNT_DISABLED',
  'WORKSPACE_ACCESS_DENIED',
]);

/**
 * The browser's side of single sign-on: the cookie that carries a sign-in
 * across the round trip, and where the browser is sent at the end of it.
 *
 * Every ending is a redirect to the web app, never an error page from the
 * API: a session (cookie set, then `/sso/complete`), a two-step challenge
 * (in the URL's fragment, so it reaches neither a log nor a Referer), or an
 * error code the sign-in or settings page knows how to say.
 */
@Injectable()
export class SsoResponder {
  private readonly logger = new Logger(SsoResponder.name);
  private readonly key: Buffer;

  constructor(
    private readonly config: AppConfigService,
    private readonly auth: AuthService,
  ) {
    this.key = deriveKey(`${config.webhooks.encryptionKeyMaterial}:sso`);
  }

  get webUrl(): string {
    return this.config.sso.webUrl;
  }

  remember(response: Response, state: SsoState): void {
    response.cookie(SSO_COOKIE, sealSsoState(this.key, state), ssoCookieOptions(this.config));
  }

  /** The state this browser started with — and the cookie is spent: a sign-in finishes once. */
  takeState(request: Request, response: Response): SsoState | null {
    const state = openSsoState(this.key, request.cookies?.[SSO_COOKIE]);
    response.clearCookie(SSO_COOKIE, ssoClearCookieOptions(this.config));
    return state;
  }

  /**
   * Hands the person to `AuthService.completeSignIn`, like every other way
   * in: a session, or with two-step verification on, a challenge for the
   * web app to finish with a code.
   */
  async signIn(
    request: Request,
    response: Response,
    user: User,
    method: SignInMethod,
    redirect: string,
  ): Promise<void> {
    const result = await this.auth.completeSignIn(user, sessionContext(request), method);
    const complete = `${this.webUrl}/sso/complete?redirect=${encodeURIComponent(redirect)}`;

    if (isTwoFactorChallenge(result)) {
      response.redirect(302, `${complete}#challenge=${encodeURIComponent(result.challenge)}`);
      return;
    }
    completeSession(result, response, this.config);
    response.redirect(302, complete);
  }

  linked(response: Response, provider: 'google' | 'microsoft' | 'saml'): void {
    response.redirect(302, `${this.webUrl}/settings?ssoLinked=${provider}`);
  }

  /** Back to where the person started — sign-in or Settings — saying what went wrong. */
  fail(response: Response, mode: SsoMode, error: unknown): void {
    const code =
      error instanceof AppException && SHOWN_CODES.has(error.code) ? error.code : 'SSO_FAILED';
    if (code === 'SSO_FAILED' && !(error instanceof AppException)) {
      this.logger.error({ err: error }, 'Single sign-on failed');
    } else {
      this.logger.log({ code, mode }, 'Single sign-on refused');
    }
    const page = mode === 'link' ? 'settings' : 'login';
    response.redirect(302, `${this.webUrl}/${page}?ssoError=${code}`);
  }
}

import { REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import type {
  AuthSession,
  AuthUser,
  ResendVerificationResult,
  TwoFactorChallenge,
  VerifyEmailResult,
} from '@coretask/types';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  verifyTwoFactorSchema,
} from '@coretask/validation';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { buildClearCookieOptions } from '../../common/utils/cookie.util';
import { parseBody } from '../../common/utils/zod-body.util';
import { AppConfigService } from '../../config/app-config.service';
import { AUTH_THROTTLE, SESSION_THROTTLE } from '../../config/throttle.config';

import { AuthService } from './auth.service';
import {
  AuthSessionDto,
  AuthUserDto,
  LogoutResultDto,
  ResendVerificationResultDto,
  VerifyEmailResultDto,
} from './dto/auth-response.dto';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import {
  completeSession,
  isTwoFactorChallenge,
  readRefreshCookie,
  sessionContext,
} from './lib/session-http';

@ApiTags('Authentication')
@Controller('auth')
@Throttle(AUTH_THROTTLE)
@SessionOnly()
@AllowUnverifiedEmail()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an account and start a session',
    description:
      'Returns a short-lived access token in the body and sets the rotating refresh token as an HTTP-only cookie.',
  })
  @ApiEnvelopeResponse(AuthSessionDto, { status: 201 })
  @ApiErrorResponseDoc(409, 'E-mail address already registered')
  @ApiErrorResponseDoc(422, 'Validation failed')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.register(dto, sessionContext(request));
    return completeSession(result, response, this.config);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'E-mail a link to set a new password',
    description:
      'Always 202, whether or not the address has an account, so the answer cannot be used to find out who does. The link works once, for an hour.',
  })
  @ApiErrorResponseDoc(422, 'Not an e-mail address')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async forgotPassword(@Body() body: unknown): Promise<{ sent: true }> {
    const input = parseBody(forgotPasswordSchema, body, 'Enter a valid e-mail address.');
    await this.auth.requestPasswordReset(input.email);
    return { sent: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password from a reset link',
    description: 'Signs the account out of every session. Sign in again with the new password.',
  })
  @ApiErrorResponseDoc(400, 'The link is invalid, used or expired')
  @ApiErrorResponseDoc(422, 'The password does not meet the policy')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async resetPassword(@Body() body: unknown): Promise<void> {
    const input = parseBody(resetPasswordSchema, body, 'The new password is invalid.');
    await this.auth.resetPassword(input.token, input.password);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange credentials for a session',
    description:
      'With two-step verification on, answers `{ twoFactorRequired: true, challenge }` instead and sets no cookie; finish at `POST /auth/two-factor/verify`.',
  })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiErrorResponseDoc(401, 'Invalid credentials')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession | TwoFactorChallenge> {
    const result = await this.auth.login(dto, sessionContext(request));
    if (isTwoFactorChallenge(result)) return result;
    return completeSession(result, response, this.config);
  }

  @Public()
  @Post('two-factor/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish signing in with a code',
    description:
      'The challenge from `login` (or from signing in with SSO) and a six-digit code from the authenticator app, or one recovery code. Five wrong codes end the challenge.',
  })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiErrorResponseDoc(400, 'The code is wrong')
  @ApiErrorResponseDoc(401, 'The challenge is invalid, expired or used up')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async verifyTwoFactor(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const input = parseBody(verifyTwoFactorSchema, body, 'Enter the code.');
    const result = await this.auth.verifyTwoFactor(input, sessionContext(request));
    return completeSession(result, response, this.config);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  // No credentials are submitted here, so the guess-rate limiter does not apply.
  // Every tab refreshes on load; the strict ceiling signed people out instead.
  @Throttle(SESSION_THROTTLE)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({
    summary: 'Rotate the refresh token and mint a new access token',
    description:
      'Reads the refresh token from the HTTP-only cookie. Presenting an already-rotated token revokes the whole session family.',
  })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiErrorResponseDoc(401, 'Missing, expired, or replayed refresh token')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const presented = readRefreshCookie(request);
    const result = await this.auth.refresh(presented, sessionContext(request));
    return completeSession(result, response, this.config);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle(SESSION_THROTTLE)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({
    summary: 'End the current session',
    description: 'Revokes the presented refresh-token family and clears the cookie.',
  })
  @ApiEnvelopeResponse(LogoutResultDto)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logout(readRefreshCookie(request));
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildClearCookieOptions(this.config));
    return { loggedOut: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sign out everywhere',
    description:
      'Revokes every session the account has, this one included, and clears the cookie. Access tokens already issued stop working at once.',
  })
  @ApiEnvelopeResponse(LogoutResultDto)
  @ApiErrorResponseDoc(401, 'Missing or invalid access token')
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logoutEverywhere(userId);
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildClearCookieOptions(this.config));
    return { loggedOut: true };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change the password while signed in',
    description:
      'Needs the current password. Signs out every other session; this one stays signed in.',
  })
  @ApiErrorResponseDoc(400, 'The current password is wrong')
  @ApiErrorResponseDoc(422, 'The new password does not meet the policy')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<void> {
    const input = parseBody(changePasswordSchema, body, 'The new password is invalid.');
    await this.auth.changePassword(user.id, user.sessionId, input);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'E-mail a new link to confirm the address',
    description:
      'Sends nothing when the address is already confirmed or a link went out under a minute ago; the answer says which.',
  })
  @ApiEnvelopeResponse(ResendVerificationResultDto)
  resendVerification(@CurrentUser('id') userId: string): Promise<ResendVerificationResult> {
    return this.auth.resendEmailVerification(userId);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an e-mail address from a link',
    description: 'The link works once, for 72 hours, and only for the address it was sent to.',
  })
  @ApiEnvelopeResponse(VerifyEmailResultDto)
  @ApiErrorResponseDoc(400, 'The link is invalid, used or expired')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async verifyEmail(@Body() body: unknown): Promise<VerifyEmailResult> {
    const input = parseBody(verifyEmailSchema, body, 'The confirmation link is incomplete.');
    return this.auth.verifyEmail(input.token);
  }

  @Get('me')
  @Throttle(SESSION_THROTTLE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user' })
  @ApiEnvelopeResponse(AuthUserDto)
  @ApiErrorResponseDoc(401, 'Missing or invalid access token')
  me(@CurrentUser('id') userId: string): Promise<AuthUser> {
    return this.auth.me(userId);
  }
}

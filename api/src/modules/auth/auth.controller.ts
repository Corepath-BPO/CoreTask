import { REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import type { AuthSession, AuthUser } from '@coretask/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { buildClearCookieOptions, buildRefreshCookieOptions } from '../../common/utils/cookie.util';
import { AppConfigService } from '../../config/app-config.service';
import { AUTH_THROTTLE, SESSION_THROTTLE } from '../../config/throttle.config';

import { AuthService, type AuthResult } from './auth.service';
import { AuthSessionDto, AuthUserDto, LogoutResultDto } from './dto/auth-response.dto';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import type { SessionContext } from './token.service';

@ApiTags('Authentication')
@Controller('auth')
@Throttle(AUTH_THROTTLE)
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
    return this.completeSession(result, response);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for a session' })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiErrorResponseDoc(401, 'Invalid credentials')
  @ApiErrorResponseDoc(429, 'Too many attempts')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.login(dto, sessionContext(request));
    return this.completeSession(result, response);
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
    return this.completeSession(result, response);
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

  @Get('me')
  @Throttle(SESSION_THROTTLE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user' })
  @ApiEnvelopeResponse(AuthUserDto)
  @ApiErrorResponseDoc(401, 'Missing or invalid access token')
  me(@CurrentUser('id') userId: string): Promise<AuthUser> {
    return this.auth.me(userId);
  }

  /** Sets the rotated refresh cookie and returns only the body-safe half. */
  private completeSession(result: AuthResult, response: Response): AuthSession {
    response.cookie(
      REFRESH_TOKEN_COOKIE,
      result.refreshToken,
      buildRefreshCookieOptions(this.config, result.refreshExpiresInMs),
    );

    return result.session;
  }
}

function readRefreshCookie(request: Request): string | undefined {
  const value = request.cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sessionContext(request: Request): SessionContext {
  const context: SessionContext = {};
  const userAgent = request.headers['user-agent'];

  if (typeof userAgent === 'string') context.userAgent = userAgent;
  if (request.ip) context.ipAddress = request.ip;

  return context;
}

import type { AccountSession, RevokeSessionsResult } from '@coretask/types';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/api.types';

import { TokenService } from './token.service';

/**
 * The browsers and devices the account is signed in on, and signing any of
 * them out. A signed-out session stops at its next request: the access token
 * it holds is checked against the session every time.
 */
@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('auth/sessions')
@SessionOnly()
@AllowUnverifiedEmail()
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class SessionsController {
  private readonly logger = new Logger(SessionsController.name);

  constructor(private readonly tokens: TokenService) {}

  @Get()
  @ApiOperation({ summary: 'List the sessions the account has open' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<AccountSession[]> {
    return this.tokens.listSessions(user.id, user.sessionId);
  }

  @Post('revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out every session but this one' })
  async revokeOthers(@CurrentUser() user: AuthenticatedUser): Promise<RevokeSessionsResult> {
    const revoked = await this.tokens.revokeAllForUser(
      user.id,
      user.sessionId ? { exceptSessionId: user.sessionId } : {},
    );
    this.logger.log({ userId: user.id, revoked }, 'Signed out the other sessions');
    return { revoked };
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out one session',
    description: 'Not this one — sign out for that.',
  })
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'It is the current session')
  @ApiErrorResponseDoc(404, 'No such open session')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    if (sessionId === user.sessionId) throw AppException.badRequest('SESSION_IS_CURRENT');
    if (!(await this.tokens.revokeSessionOf(user.id, sessionId))) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'That session is not open.');
    }
    this.logger.log({ userId: user.id, sessionId }, 'Signed out a session');
  }
}

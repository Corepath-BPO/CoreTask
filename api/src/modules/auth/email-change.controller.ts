import type { ConfirmEmailChangeResult, PendingEmailChange } from '@coretask/types';
import { confirmEmailChangeSchema, requestEmailChangeSchema } from '@coretask/validation';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { parseBody } from '../../common/utils/zod-body.util';
import { AUTH_THROTTLE, SESSION_THROTTLE } from '../../config/throttle.config';

import { EmailChangeService } from './email-change.service';

/**
 * Changing the account's e-mail address. Allowed with an unconfirmed address
 * past its deadline: a typo at sign-up is exactly how an address ends up
 * unconfirmable.
 */
@ApiTags('Authentication')
@Controller('auth/email-change')
@SessionOnly()
@AllowUnverifiedEmail()
@Throttle(AUTH_THROTTLE)
export class EmailChangeController {
  constructor(private readonly emailChange: EmailChangeService) {}

  @Get()
  @Throttle(SESSION_THROTTLE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The change waiting for its link, if any' })
  pending(@CurrentUser('id') userId: string): Promise<PendingEmailChange | null> {
    return this.emailChange.pending(userId);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ask to move the account to a new address',
    description:
      'Needs the password (or a code). A link goes to the new address and a notice to the current one; nothing changes until the link is used.',
  })
  @ApiErrorResponseDoc(400, 'Not confirmed, or the same address')
  @ApiErrorResponseDoc(409, 'The address belongs to another account')
  @ApiErrorResponseDoc(429, 'A link went out under a minute ago')
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PendingEmailChange> {
    const input = parseBody(requestEmailChangeSchema, body, 'Enter a valid e-mail address.');
    return this.emailChange.request(user.id, user.sessionId, input);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel the waiting change' })
  async cancel(@CurrentUser('id') userId: string): Promise<void> {
    await this.emailChange.cancel(userId);
  }

  @Public()
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Use the link sent to the new address',
    description: 'Public: the link may be opened on a device that is not signed in.',
  })
  @ApiErrorResponseDoc(400, 'The link is invalid, used or expired')
  @ApiErrorResponseDoc(409, 'The address was taken in the meantime')
  confirm(@Body() body: unknown): Promise<ConfirmEmailChangeResult> {
    const input = parseBody(confirmEmailChangeSchema, body, 'The link is incomplete.');
    return this.emailChange.confirm(input.token);
  }
}

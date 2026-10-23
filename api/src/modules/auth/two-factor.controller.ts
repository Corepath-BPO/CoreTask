import type { TwoFactorRecoveryCodes, TwoFactorSetup, TwoFactorStatus } from '@coretask/types';
import { enableTwoFactorSchema, reauthSchema } from '@coretask/validation';
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { parseBody } from '../../common/utils/zod-body.util';
import { AUTH_THROTTLE, SESSION_THROTTLE } from '../../config/throttle.config';

import { ReauthService } from './reauth.service';
import { TwoFactorService } from './two-factor.service';

/**
 * Two-step verification, set up and managed from Settings. The sign-in half
 * — `POST /auth/two-factor/verify` — is on `AuthController`, with the other
 * public routes.
 */
@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('auth/two-factor')
@SessionOnly()
@AllowUnverifiedEmail()
@Throttle(AUTH_THROTTLE)
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly reauth: ReauthService,
  ) {}

  @Get()
  // A read the settings page makes on every visit, not a guess at anything.
  @Throttle(SESSION_THROTTLE)
  @ApiOperation({ summary: 'Whether two-step verification is on' })
  status(@CurrentUser('id') userId: string): Promise<TwoFactorStatus> {
    return this.twoFactor.status(userId);
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start setting up: a new secret, as a QR code',
    description: 'Nothing is saved until `enable` receives a code made from it.',
  })
  @ApiErrorResponseDoc(409, 'Already on')
  setup(@CurrentUser('id') userId: string): Promise<TwoFactorSetup> {
    return this.twoFactor.setup(userId);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish setting up with the first code',
    description: 'Answers the recovery codes. They are never shown again.',
  })
  @ApiErrorResponseDoc(400, 'The code is wrong, or the setup expired')
  enable(
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<TwoFactorRecoveryCodes> {
    const input = parseBody(enableTwoFactorSchema, body, 'Enter the code from the app.');
    return this.twoFactor.enable(userId, input);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Turn two-step verification off',
    description: 'Needs the password, or a code when the account has no password.',
  })
  @ApiErrorResponseDoc(400, 'Not confirmed, or not on')
  async disable(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<void> {
    const input = parseBody(reauthSchema, body, 'Confirm it is you.');
    await this.reauth.assert(user.id, user.sessionId, input);
    await this.twoFactor.disable(user.id);
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace the recovery codes',
    description: 'The old ones stop working. Needs the password, or a code.',
  })
  @ApiErrorResponseDoc(400, 'Not confirmed, or not on')
  async regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<TwoFactorRecoveryCodes> {
    const input = parseBody(reauthSchema, body, 'Confirm it is you.');
    await this.reauth.assert(user.id, user.sessionId, input);
    return this.twoFactor.regenerateRecoveryCodes(user.id);
  }
}

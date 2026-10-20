import {
  ACCOUNT_DELETION_CONFIRMATION,
  REFRESH_TOKEN_COOKIE,
  WorkspaceRole,
} from '@coretask/contracts';
import type { AccountDeletionPreview } from '@coretask/types';
import { deleteAccountSchema, deleteWorkspaceSchema } from '@coretask/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { buildClearCookieOptions } from '../../common/utils/cookie.util';
import { parseBody } from '../../common/utils/zod-body.util';
import { AppConfigService } from '../../config/app-config.service';
import { AUTH_THROTTLE } from '../../config/throttle.config';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AccountDeletionService } from './account-deletion.service';
import { WorkspaceDeletionService } from './workspace-deletion.service';

/**
 * Deleting your own account. Session-only: neither an API key nor an app
 * acting for someone may end the account behind it. Allowed with an
 * unconfirmed address, since that can be why someone wants out.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me')
@SessionOnly()
@AllowUnverifiedEmail()
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class AccountDeletionController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly config: AppConfigService,
  ) {}

  @Get('deletion')
  @ApiOperation({
    summary: 'What deleting the account would take with it',
    description:
      'Workspaces deleted with it (owned, nobody else in them), workspaces that block it (owned, with other people), the ones it would leave, and which proof the deletion will ask for.',
  })
  preview(@CurrentUser('id') userId: string): Promise<AccountDeletionPreview> {
    return this.deletion.preview(userId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Delete the account',
    description: `Needs \`confirmation: "${ACCOUNT_DELETION_CONFIRMATION}"\` and the password (or a code). Deletes the workspaces only you are in, leaves the others, and signs out everywhere. Cannot be undone.`,
  })
  @ApiErrorResponseDoc(400, 'Not confirmed, or the password or code is wrong')
  @ApiErrorResponseDoc(403, 'An account with no password must have signed in recently')
  @ApiErrorResponseDoc(409, 'The account owns workspaces other people are in')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // Typed wrong is its own answer, the same one deleting a workspace gives,
    // rather than a validation failure on a field that was filled in.
    const typed = (body as { confirmation?: unknown } | null)?.confirmation;
    if (typeof typed === 'string' && typed !== ACCOUNT_DELETION_CONFIRMATION) {
      throw AppException.badRequest('CONFIRMATION_MISMATCH');
    }
    const input = parseBody(
      deleteAccountSchema,
      body,
      `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm.`,
    );

    await this.deletion.delete(user.id, user.sessionId, input);
    response.clearCookie(REFRESH_TOKEN_COOKIE, buildClearCookieOptions(this.config));
  }
}

/**
 * Deleting a workspace. Owner only, session only, and with the name typed
 * back: everything in it goes, for everyone, with no undo.
 */
@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspaceDeletionController {
  constructor(private readonly deletion: WorkspaceDeletionService) {}

  @Delete(':workspaceId')
  @SessionOnly()
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole(WorkspaceRole.OWNER)
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a workspace',
    description:
      'Requires OWNER, `confirmation` equal to the workspace name, and the password (or a code). Deletes every project, task, comment, file, key and webhook in it.',
  })
  @ApiParam({ name: 'workspaceId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The name does not match, or the password or code is wrong')
  @ApiErrorResponseDoc(403, 'Not the owner')
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<void> {
    const input = parseBody(deleteWorkspaceSchema, body, 'Type the workspace name to confirm.');
    await this.deletion.deleteAsOwner(
      workspaceId,
      { id: user.id, sessionId: user.sessionId },
      input,
    );
  }
}

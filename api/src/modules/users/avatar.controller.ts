import type { AuthUser, AvatarUpload } from '@coretask/types';
import { confirmAvatarUploadSchema, createAvatarUploadSchema } from '@coretask/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowUnverifiedEmail } from '../../common/decorators/email-verification.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { parseBody } from '../../common/utils/zod-body.util';

import { AvatarService } from './avatar.service';

/**
 * The caller's own picture. Session-only, like the rest of the profile, and
 * allowed with an unconfirmed address: a picture sends nobody anything.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me/avatar')
@SessionOnly()
@AllowUnverifiedEmail()
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Post()
  @ApiOperation({
    summary: 'Somewhere to upload a profile picture',
    description:
      'PUT the bytes to `uploadUrl` with exactly `headers`, then confirm with `uploadToken`. PNG, JPEG, WebP or GIF, up to 2 MB.',
  })
  @ApiErrorResponseDoc(422, 'Not a picture type that is accepted, or too large')
  createUpload(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<AvatarUpload> {
    const input = parseBody(
      createAvatarUploadSchema,
      body,
      'Use a PNG, JPEG, WebP or GIF picture.',
    );
    return this.avatars.createUpload(userId, input);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Use the uploaded picture',
    description:
      'Checks what arrived: anything too large or not the declared type is deleted and refused.',
  })
  @ApiErrorResponseDoc(400, 'Nothing arrived, too large, the wrong type, or the upload expired')
  confirm(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<AuthUser> {
    const input = parseBody(confirmAvatarUploadSchema, body, 'The upload is incomplete.');
    return this.avatars.confirm(userId, input.uploadToken);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove the profile picture' })
  remove(@CurrentUser('id') userId: string): Promise<AuthUser> {
    return this.avatars.remove(userId);
  }
}

/**
 * The picture itself, as every `avatarUrl` names it. Public, because it is an
 * `<img src>` on the web app's origin, which sends no token; and unthrottled,
 * because one member list asks for dozens at once.
 */
@ApiTags('Users')
@Controller('users')
@Public()
@SkipThrottle()
export class AvatarImageController {
  constructor(private readonly avatars: AvatarService) {}

  @Get(':userId/avatar')
  @ApiOperation({
    summary: 'A profile picture',
    description: 'Redirects to a short-lived signed URL for the picture.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'This person has no uploaded picture')
  async view(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { url, expiresInSeconds } = await this.avatars.view(userId);
    response
      .set({
        // Helmet answers `same-origin`, which keeps an <img> on the web app's
        // origin from following the redirect at all.
        'Cross-Origin-Resource-Policy': 'cross-origin',
        // Cached a minute less than the signed URL lasts, so a cached
        // redirect never points at an expired signature.
        'Cache-Control': `private, max-age=${Math.max(expiresInSeconds - 60, 0)}`,
      })
      .redirect(HttpStatus.FOUND, url);
  }
}

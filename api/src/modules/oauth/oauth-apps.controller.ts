import type { ConnectedApp, CreatedOAuthApp, OAuthApp, OAuthSecretRotation } from '@coretask/types';
import { createOAuthAppSchema, updateOAuthAppSchema } from '@coretask/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/email-verification.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { parseBody } from '../../common/utils/zod-body.util';

import {
  ConnectedAppDto,
  CreatedOAuthAppDto,
  OAuthAppDto,
  OAuthSecretRotationDto,
} from './dto/oauth.dto';
import { OAuthAppsService } from './oauth-apps.service';
import { OAuthService } from './oauth.service';

/**
 * The apps a person registered as a developer. Their own, so no workspace in
 * the path — and session-only, because a credential that could register apps
 * could mint itself new ones.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('users/me/oauth-apps')
@SessionOnly()
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is an API key or an OAuth app')
export class OAuthAppsController {
  constructor(private readonly apps: OAuthAppsService) {}

  @Get()
  @ApiOperation({ summary: 'List your OAuth apps' })
  @ApiEnvelopeResponse(OAuthAppDto, { isArray: true })
  list(@CurrentUser('id') userId: string): Promise<OAuthApp[]> {
    return this.apps.list(userId);
  }

  @Post()
  @RequireVerifiedEmail()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register an OAuth app',
    description:
      'The client secret is in this response and nowhere else afterwards. Redirect URIs are https, or http on localhost while developing, and are matched exactly.',
  })
  @ApiEnvelopeResponse(CreatedOAuthAppDto, { status: 201 })
  @ApiErrorResponseDoc(409, 'You already have the maximum number of apps')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<CreatedOAuthApp> {
    const input = parseBody(createOAuthAppSchema, body, 'The app is invalid.');
    return this.apps.create(userId, input);
  }

  @Patch(':appId')
  @ApiOperation({ summary: 'Change an OAuth app’s name, description, website or redirect URIs' })
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiEnvelopeResponse(OAuthAppDto)
  @ApiErrorResponseDoc(404, 'No such app of yours')
  @ApiErrorResponseDoc(422, 'Validation failed')
  update(
    @CurrentUser('id') userId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: unknown,
  ): Promise<OAuthApp> {
    const input = parseBody(updateOAuthAppSchema, body, 'The change is invalid.');
    return this.apps.update(userId, appId, input);
  }

  @Post(':appId/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace the client secret',
    description: 'The old secret stops working at once. Connected people stay connected.',
  })
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiEnvelopeResponse(OAuthSecretRotationDto)
  @ApiErrorResponseDoc(404, 'No such app of yours')
  rotateSecret(
    @CurrentUser('id') userId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
  ): Promise<OAuthSecretRotation> {
    return this.apps.rotateSecret(userId, appId);
  }

  @Delete(':appId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an OAuth app',
    description:
      'Disconnects everyone who connected it and deletes the webhooks it subscribed. Final.',
  })
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such app of yours')
  async remove(
    @CurrentUser('id') userId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
  ): Promise<void> {
    await this.apps.remove(userId, appId);
  }
}

/** The apps a person has allowed to act for them. */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('users/me/connected-apps')
@SessionOnly()
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is an API key or an OAuth app')
export class ConnectedAppsController {
  constructor(private readonly oauth: OAuthService) {}

  @Get()
  @ApiOperation({ summary: 'List the apps you have connected' })
  @ApiEnvelopeResponse(ConnectedAppDto, { isArray: true })
  list(@CurrentUser('id') userId: string): Promise<ConnectedApp[]> {
    return this.oauth.connectedApps(userId);
  }

  @Delete(':appId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect an app',
    description:
      'Its tokens stop working at once and the webhooks it subscribed for you are deleted.',
  })
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'That app is not connected')
  async disconnect(
    @CurrentUser('id') userId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
  ): Promise<void> {
    await this.oauth.disconnect(userId, appId);
  }
}

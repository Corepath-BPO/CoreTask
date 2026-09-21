import type { IntegrationWhoAmI } from '@coretask/types';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/api.types';

import { ApiKeysService } from './api-keys.service';
import { IntegrationWhoAmIDto } from './dto/api-key-response.dto';

/**
 * Not under `/workspaces/:workspaceId` on purpose: a tool calls this to find out
 * which workspace its key belongs to, so it cannot be asked to know that first.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('integration')
export class IntegrationController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get('whoami')
  @ApiOperation({
    summary: 'Check the credential and learn its workspace',
    description:
      'For an API key: the key, its role and the workspace id every other call needs. For a signed-in person: the user only.',
  })
  @ApiEnvelopeResponse(IntegrationWhoAmIDto)
  @ApiErrorResponseDoc(401, 'Missing, invalid, revoked or expired credential')
  whoami(@CurrentUser() user: AuthenticatedUser): Promise<IntegrationWhoAmI> {
    return this.apiKeys.whoami(user);
  }
}

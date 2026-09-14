import { API_KEY_ROLES, INTEGRATION_PRINCIPALS, WORKSPACE_ROLES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `ApiKey*` and `IntegrationWhoAmI` in `@coretask/types`. */

export class ApiKeyCreatorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

/** Note the absence of the secret: it is returned once, at creation, and never again. */
export class ApiKeyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'n8n' })
  name!: string;

  @ApiProperty({
    example: 'ctk_AbCdEfGh',
    description: 'Enough to recognise the key, never enough to use it.',
  })
  prefix!: string;

  @ApiProperty({ enum: API_KEY_ROLES, example: 'MEMBER' })
  role!: string;

  @ApiProperty({ format: 'uuid', description: 'The service account the key acts as.' })
  userId!: string;

  @ApiProperty({ type: ApiKeyCreatorDto, nullable: true })
  createdBy!: ApiKeyCreatorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastUsedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  expiresAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  revokedAt!: string | null;

  @ApiProperty({ example: false, description: 'Decided by the server, not the client clock.' })
  expired!: boolean;
}

export class CreatedApiKeyDto {
  @ApiProperty({ type: ApiKeyDto })
  key!: ApiKeyDto;

  @ApiProperty({
    example: 'ctk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg',
    description: 'Shown once. Send it as `X-API-Key` or `Authorization: Bearer`.',
  })
  secret!: string;
}

export class WhoAmIUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'n8n' })
  name!: string;

  @ApiProperty({ example: 'api-key-…@integrations.coretask.invalid' })
  email!: string;
}

export class WhoAmIWorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CoreTask Demo' })
  name!: string;

  @ApiProperty({ example: 'coretask-demo' })
  slug!: string;
}

export class WhoAmIKeyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'n8n' })
  name!: string;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'MEMBER' })
  role!: string;
}

export class IntegrationWhoAmIDto {
  @ApiProperty({ enum: INTEGRATION_PRINCIPALS, example: 'api_key' })
  principal!: string;

  @ApiProperty({ type: WhoAmIUserDto })
  user!: WhoAmIUserDto;

  @ApiProperty({ type: WhoAmIWorkspaceDto, nullable: true })
  workspace!: WhoAmIWorkspaceDto | null;

  @ApiProperty({ type: WhoAmIKeyDto, nullable: true })
  apiKey!: WhoAmIKeyDto | null;
}

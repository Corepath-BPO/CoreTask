import { OAUTH_APP_POLICIES, OAUTH_CLIENT_TYPES, OAUTH_SCOPES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring the OAuth types in `@coretask/types`. */

/** Note the absence of the client secret: it is returned at creation and rotation only. */
export class OAuthAppDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Leasing sync' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'Keeps our CRM in step with CoreTask.' })
  description!: string | null;

  @ApiProperty({ nullable: true, example: 'https://example.com' })
  websiteUrl!: string | null;

  @ApiProperty({ type: [String], example: ['https://example.com/oauth/callback'] })
  redirectUris!: string[];

  @ApiProperty({ example: 'ctc_…', description: 'Public; goes in the authorization link.' })
  clientId!: string;

  @ApiProperty({
    enum: OAUTH_CLIENT_TYPES,
    example: 'confidential',
    description: 'A public client (mobile, desktop) has no secret and must use PKCE.',
  })
  clientType!: string;

  @ApiProperty({
    example: 'cts_AbCdEf',
    nullable: true,
    description: 'Enough to tell secrets apart, never enough to use one. Null for a public client.',
  })
  secretHint!: string | null;

  @ApiProperty({ example: 3, description: 'People who have it connected now.' })
  connections!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CreatedOAuthAppDto {
  @ApiProperty({ type: OAuthAppDto })
  app!: OAuthAppDto;

  @ApiProperty({
    example: 'cts_…',
    nullable: true,
    description: 'Shown once. Store it in the tool now. Null for a public client, which has none.',
  })
  clientSecret!: string | null;
}

export class OAuthSecretRotationDto {
  @ApiProperty({ example: 'cts_…', description: 'Shown once. The old secret stopped working.' })
  clientSecret!: string;
}

class OAuthConsentAppDto {
  @ApiProperty({ example: 'Leasing sync' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  websiteUrl!: string | null;

  @ApiProperty({ example: 'Ada Lovelace', description: 'Who registered the app.' })
  publisher!: string;
}

class OAuthConsentScopeDto {
  @ApiProperty({ enum: OAUTH_SCOPES, example: 'default' })
  scope!: string;

  @ApiProperty()
  description!: string;
}

class WorkspaceRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Leasing' })
  name!: string;
}

export class OAuthConsentDto {
  @ApiProperty({ type: OAuthConsentAppDto })
  app!: OAuthConsentAppDto;

  @ApiProperty({ type: [OAuthConsentScopeDto] })
  scopes!: OAuthConsentScopeDto[];

  @ApiProperty({ example: 'example.com' })
  redirectHost!: string;

  @ApiProperty({
    type: [WorkspaceRefDto],
    description:
      'The person’s workspaces that allow only approved apps and have not approved this one.',
  })
  blockedWorkspaces!: WorkspaceRefDto[];
}

export class OAuthRedirectDto {
  @ApiProperty({
    example: 'https://example.com/oauth/callback?code=…&state=…',
    description: 'Where the browser goes next: the redirect URI, with a code or an error.',
  })
  redirectTo!: string;
}

class ConnectedAppAppDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  websiteUrl!: string | null;

  @ApiProperty()
  publisher!: string;
}

export class ConnectedAppDto {
  @ApiProperty({ type: ConnectedAppAppDto })
  app!: ConnectedAppAppDto;

  @ApiProperty({ enum: OAUTH_SCOPES, isArray: true })
  scopes!: string[];

  @ApiProperty({ format: 'date-time' })
  connectedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastUsedAt!: string | null;

  @ApiProperty({ example: 1 })
  connections!: number;
}

/** RFC 6749 §5.1, unwrapped: OAuth clients read these fields at the top level. */
export class OAuthTokenResponseDto {
  @ApiProperty({ example: 'cto_…' })
  access_token!: string;

  @ApiProperty({ example: 'bearer' })
  token_type!: string;

  @ApiProperty({ example: 3600 })
  expires_in!: number;

  @ApiProperty({ example: 'ctr_…', required: false, description: 'On the code exchange only.' })
  refresh_token?: string;

  @ApiProperty({ example: 'default' })
  scope!: string;
}

class WorkspaceAppSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ctc_…', description: 'Public; how an admin names the app.' })
  clientId!: string;

  @ApiProperty({ example: 'Leasing sync' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  websiteUrl!: string | null;

  @ApiProperty({ example: 'Ada Lovelace', description: 'Who registered the app.' })
  publisher!: string;
}

class PersonRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;
}

export class DirectoryAppDto {
  @ApiProperty({ type: WorkspaceAppSummaryDto })
  app!: WorkspaceAppSummaryDto;

  @ApiProperty({ format: 'date-time' })
  approvedAt!: string;

  @ApiProperty({ type: PersonRefDto, nullable: true })
  approvedBy!: PersonRefDto | null;

  @ApiProperty({ description: 'Whether the person asking has it connected.' })
  connectedByMe!: boolean;
}

class UnapprovedAppDto {
  @ApiProperty({ type: WorkspaceAppSummaryDto })
  app!: WorkspaceAppSummaryDto;

  @ApiProperty({ example: 2, description: 'Members of this workspace connected to it.' })
  members!: number;
}

export class WorkspaceAppDirectoryDto {
  @ApiProperty({ enum: OAUTH_APP_POLICIES, example: 'ANY' })
  policy!: string;

  @ApiProperty({ type: [DirectoryAppDto] })
  apps!: DirectoryAppDto[];

  @ApiProperty({
    type: [UnapprovedAppDto],
    description: 'Apps members connected that are not in the directory. Admins only.',
  })
  unapproved!: UnapprovedAppDto[];
}

import { ApiProperty } from '@nestjs/swagger';

/** Swagger models for the auth responses. Shapes match `@coretask/types`. */

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ example: 'Demo User' })
  name!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;

  @ApiProperty({ example: 'UTC' })
  timezone!: string;

  @ApiProperty({ example: false })
  emailVerified!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AuthSessionDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({
    description:
      'Short-lived bearer token. Held in memory by the client; the refresh token travels only in an HTTP-only cookie.',
  })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;
}

export class LogoutResultDto {
  @ApiProperty({ example: true })
  loggedOut!: boolean;
}

import {
  DESCRIPTION_MAX_LENGTH,
  HEX_COLOR_PATTERN,
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Treats `''` as "clear this field", which is what an emptied form input sends. */
const emptyToNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  );

export class CreateTeamDto {
  @ApiProperty({ example: 'Platform', minLength: TEAM_NAME_MIN_LENGTH })
  @trim()
  @IsString()
  @Length(TEAM_NAME_MIN_LENGTH, TEAM_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ example: '#6366F1' })
  @IsOptional()
  @trim()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: 'Enter a valid hex colour.' })
  color?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Must already be a member of the workspace. Appointing a lead also adds them to the team.',
  })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadId?: string | null;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ example: 'Platform', minLength: TEAM_NAME_MIN_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(TEAM_NAME_MIN_LENGTH, TEAM_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH, nullable: true })
  @IsOptional()
  @trim()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ example: '#6366F1' })
  @IsOptional()
  @trim()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: 'Enter a valid hex colour.' })
  color?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Null stands the team down to no lead.',
  })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadId?: string | null;
}

export class AddTeamMemberDto {
  @ApiProperty({
    format: 'uuid',
    description: 'A user who is already a member of this workspace.',
  })
  @IsUUID()
  userId!: string;
}

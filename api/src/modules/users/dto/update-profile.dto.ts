import {
  OUT_OF_OFFICE_NOTE_MAX,
  PROFILE_ABOUT_ME_MAX,
  PROFILE_DEPARTMENT_MAX,
  PROFILE_JOB_TITLE_MAX,
  PROFILE_PRONOUNS_MAX,
} from '@coretask/contracts';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class OutOfOfficeDto {
  @ApiPropertyOptional({ example: '2026-10-19' })
  @Matches(DAY, { message: 'from must be a yyyy-mm-dd day' })
  from!: string;

  @ApiPropertyOptional({ example: '2026-10-23' })
  @Matches(DAY, { message: 'until must be a yyyy-mm-dd day' })
  until!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: OUT_OF_OFFICE_NOTE_MAX })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(OUT_OF_OFFICE_NOTE_MAX)
  note?: string | null;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ada Lovelace' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'America/Chicago' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ nullable: true, example: 'she/her', maxLength: PROFILE_PRONOUNS_MAX })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROFILE_PRONOUNS_MAX)
  pronouns?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Leasing manager',
    maxLength: PROFILE_JOB_TITLE_MAX,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROFILE_JOB_TITLE_MAX)
  jobTitle?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Operations', maxLength: PROFILE_DEPARTMENT_MAX })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROFILE_DEPARTMENT_MAX)
  department?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PROFILE_ABOUT_ME_MAX })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROFILE_ABOUT_ME_MAX)
  aboutMe?: string | null;

  @ApiPropertyOptional({ type: OutOfOfficeDto, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => OutOfOfficeDto)
  outOfOffice?: OutOfOfficeDto | null;
}

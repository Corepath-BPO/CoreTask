import { SECTION_NAME_MAX_LENGTH, SECTION_NAME_MIN_LENGTH } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateSectionDto {
  @ApiProperty({ example: 'In Progress' })
  @trim()
  @IsString()
  @Length(SECTION_NAME_MIN_LENGTH, SECTION_NAME_MAX_LENGTH)
  name!: string;

  /**
   * Placement is relative to a sibling, never a raw number: the server owns the
   * fractional maths so a client cannot write a position that collides with, or
   * sorts oddly against, its neighbours.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Insert after this section. `null` places it first; omit to append.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  afterSectionId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Applied to a task moved into this section, and to nothing else. Null — the default — ' +
      'means moving a card here changes only where it sits.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  defaultStatusId?: string | null;
}

export class UpdateSectionDto {
  @ApiPropertyOptional({ example: 'Ready for QA' })
  @IsOptional()
  @trim()
  @IsString()
  @Length(SECTION_NAME_MIN_LENGTH, SECTION_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  defaultStatusId?: string | null;
}

export class MoveSectionDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Sibling to sit after. `null` moves the section to the first position.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  afterSectionId!: string | null;
}

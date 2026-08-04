import { ALLOWED_UPLOAD_MIME_TYPES, FILENAME_MAX_LENGTH } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * A filename must not look like a path or carry control characters.
 *
 * The stored key is built from a fresh UUID, so this is not what protects the
 * bucket. It stops a name that would be nonsense to display and dangerous to
 * echo into the `Content-Disposition` header of a download.
 */
@ValidatorConstraint({ name: 'isSafeFilename' })
class IsSafeFilenameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (value.includes('/') || value.includes('\\')) return false;
    if (value === '.' || value === '..') return false;

    return ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    });
  }

  defaultMessage(): string {
    return 'filename cannot contain slashes, control characters, or be a path segment';
  }
}

export class CreateAttachmentDto {
  @ApiProperty({ example: 'design-review.pdf', maxLength: FILENAME_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(FILENAME_MAX_LENGTH)
  @Validate(IsSafeFilenameConstraint)
  filename!: string;

  @ApiProperty({ enum: ALLOWED_UPLOAD_MIME_TYPES, example: 'application/pdf' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(ALLOWED_UPLOAD_MIME_TYPES)
  mimeType!: string;

  @ApiProperty({
    example: 51_200,
    description:
      'What the client expects to upload. Bounds the presigned URL and gives a fast error, but the stored object is re-read on confirm — a presigned PUT cannot enforce a size limit.',
  })
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exactly one of taskId or ticketId.' })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exactly one of taskId or ticketId.' })
  @IsOptional()
  @IsUUID()
  ticketId?: string;
}

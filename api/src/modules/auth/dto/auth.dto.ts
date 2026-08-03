import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * The constraints here mirror `@coretask/validation`'s Zod schemas, which the
 * web client uses for the same forms. Both read their bounds from
 * `@coretask/contracts`, so the two layers cannot drift apart.
 */

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const lower = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class RegisterDto {
  @ApiProperty({ example: 'Ada Lovelace', minLength: NAME_MIN_LENGTH, maxLength: NAME_MAX_LENGTH })
  @trim()
  @IsString()
  @Length(NAME_MIN_LENGTH, NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ example: 'ada@coretask.dev', maxLength: EMAIL_MAX_LENGTH })
  @lower()
  @IsEmail({}, { message: 'Enter a valid e-mail address.' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    example: 'CoreTask!2024',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'At least three of: lowercase, uppercase, number, symbol.',
  })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  @Matches(
    /^(?:(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9])|(?=.*[a-z])(?=.*\d)(?=.*[^a-zA-Z0-9])|(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])).+$/,
    { message: 'Use at least three of: lowercase, uppercase, number, symbol.' },
  )
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'demo@coretask.dev' })
  @lower()
  @IsEmail({}, { message: 'Enter a valid e-mail address.' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  // Deliberately no complexity rule: rejecting a login for failing the *current*
  // password policy would leak the policy and break grandfathered accounts.
  @ApiProperty({ example: 'CoreTask!2024' })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

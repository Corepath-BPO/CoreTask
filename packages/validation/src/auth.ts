import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@coretask/contracts';
import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'E-mail address is required.')
  .max(EMAIL_MAX_LENGTH, `E-mail address must be at most ${EMAIL_MAX_LENGTH} characters.`)
  .toLowerCase()
  .pipe(z.email('Enter a valid e-mail address.'));

/**
 * Password policy: length plus three of four character classes.
 *
 * Length carries most of the entropy, so the class requirement is intentionally
 * lenient rather than the classic "must contain a symbol" rule that pushes users
 * toward `Password1!`.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => countCharacterClasses(value) >= 3, {
    message: 'Use at least three of: lowercase, uppercase, number, symbol.',
  });

export const nameSchema = z
  .string()
  .trim()
  .min(NAME_MIN_LENGTH, 'Name is required.')
  .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters.`);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

/** Login never re-applies the password policy — it would leak the rules to attackers. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});
export type LoginInput = z.input<typeof loginSchema>;

/** "Forgot password": just the address. The answer is the same whether it has an account. */
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

/** The token from the link and the new password, held to the same policy as registering. */
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'The reset link is incomplete.').max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const resetPasswordFormSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
export type ResetPasswordFormInput = z.input<typeof resetPasswordFormSchema>;

/**
 * Changing a password while signed in. The current one is checked by the
 * server, not here — like login, its only rule is that it was typed.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'Choose a password you are not using now.',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const changePasswordFormSchema = changePasswordSchema
  .safeExtend({ confirmPassword: z.string().min(1, 'Confirm your new password.') })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
export type ChangePasswordFormInput = z.input<typeof changePasswordFormSchema>;

/** The token from a "confirm your e-mail address" link. */
export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'The confirmation link is incomplete.').max(200),
});
export type VerifyEmailInput = z.input<typeof verifyEmailSchema>;

export const registerFormSchema = registerSchema
  .extend({
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    // `boolean().refine()` rather than `literal(true)`: the checkbox starts
    // unchecked, so the *input* type has to allow `false` for the form to have a
    // valid initial state.
    acceptTerms: z.boolean().refine((accepted) => accepted, {
      message: 'You must accept the terms to continue.',
    }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
export type RegisterFormInput = z.input<typeof registerFormSchema>;

function countCharacterClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(value))
    .length;
}

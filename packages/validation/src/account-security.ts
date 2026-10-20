import {
  ACCOUNT_DELETION_CONFIRMATION,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  PASSWORD_MAX_LENGTH,
  TOTP_DIGITS,
  TWO_FACTOR_RECOVERY_CODE_PATTERN,
} from '@coretask/contracts';
import { z } from 'zod';

import { emailSchema } from './auth.js';

/**
 * A code from the authenticator app (six digits; spaces forgiven, since apps
 * show it as `123 456`) or a recovery code (`abcd-efgh-jkmn-pqrs`). Which one
 * it is, the server works out from the shape.
 */
export const twoFactorCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter the code.')
  .max(40)
  .transform((value) => value.replace(/\s+/g, ''))
  .refine(
    (value) =>
      new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(value) ||
      TWO_FACTOR_RECOVERY_CODE_PATTERN.test(value),
    { message: `Enter the ${TOTP_DIGITS}-digit code, or a recovery code.` },
  );

/** Only the six digits: setting up has to prove the app works, not a recovery code. */
export const totpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ''))
  .refine((value) => new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(value), {
    message: `Enter the ${TOTP_DIGITS}-digit code from the app.`,
  });

export const verifyTwoFactorSchema = z.object({
  challenge: z.string().trim().min(1, 'The sign-in expired. Start again.').max(2_000),
  code: twoFactorCodeSchema,
});
export type VerifyTwoFactorInput = z.input<typeof verifyTwoFactorSchema>;

export const enableTwoFactorSchema = z.object({
  setupToken: z.string().trim().min(1).max(2_000),
  code: totpCodeSchema,
});
export type EnableTwoFactorInput = z.input<typeof enableTwoFactorSchema>;

/**
 * "Confirm it is you". Both optional here: which one is needed depends on the
 * account, and the server says so with `REAUTH_REQUIRED`.
 */
export const reauthSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
  code: twoFactorCodeSchema.optional(),
});
export type ReauthInput = z.input<typeof reauthSchema>;

export const requestEmailChangeSchema = reauthSchema.extend({ email: emailSchema });
export type RequestEmailChangeInput = z.input<typeof requestEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
  token: z.string().trim().min(1, 'The confirmation link is incomplete.').max(200),
});
export type ConfirmEmailChangeInput = z.input<typeof confirmEmailChangeSchema>;

export const deleteAccountSchema = reauthSchema.extend({
  confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION, {
    error: `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm.`,
  }),
});
export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;

/** The name is compared by the server, which knows it; here it only has to be typed. */
export const deleteWorkspaceSchema = reauthSchema.extend({
  confirmation: z.string().min(1, 'Type the workspace name to confirm.').max(200),
});
export type DeleteWorkspaceInput = z.input<typeof deleteWorkspaceSchema>;

export const createAvatarUploadSchema = z.object({
  mimeType: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => AVATAR_MIME_TYPES.includes(value), {
      message: 'Use a PNG, JPEG, WebP or GIF picture.',
    }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(AVATAR_MAX_BYTES, `Use a picture under ${AVATAR_MAX_BYTES / 1024 / 1024} MB.`),
});
export type CreateAvatarUploadInput = z.input<typeof createAvatarUploadSchema>;

export const confirmAvatarUploadSchema = z.object({
  uploadToken: z.string().trim().min(1).max(2_000),
});

/** A bare domain: `example.com`, never a URL or an address. */
export const workspaceDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/\.$/, ''))
    .pipe(
      z
        .string()
        .max(253)
        .regex(
          /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
          'Enter a domain such as example.com.',
        ),
    ),
});
export type WorkspaceDomainInput = z.input<typeof workspaceDomainSchema>;

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
const SSO_URL = z.url({ protocol: /^https?$/ });

/**
 * A workspace's SAML provider. Turned on, every field is needed. Turned off
 * it may be saved half done, or empty: the service provider's addresses
 * derive from the saved connection, and providers such as Okta ask for those
 * before they show their own.
 */
export const samlConnectionSchema = z
  .object({
    idpEntityId: z.string().trim().max(500),
    idpSsoUrl: z.string().trim().max(2_000),
    /**
     * PEM, or the bare base64 most providers show in a box: the server wraps a
     * bare one, so either may be pasted.
     */
    idpCertificate: z.string().trim().max(20_000),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const problem = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (!value.idpEntityId && value.enabled) {
      problem('idpEntityId', 'Enter the identity provider’s entity ID.');
    }
    if (value.idpSsoUrl ? !SSO_URL.safeParse(value.idpSsoUrl).success : value.enabled) {
      problem('idpSsoUrl', 'Enter the sign-in URL, starting https://.');
    }
    if (!value.idpCertificate) {
      if (value.enabled)
        problem('idpCertificate', 'Paste the identity provider’s signing certificate.');
    } else if (
      !PEM_CERTIFICATE.test(value.idpCertificate) &&
      !/^[A-Za-z0-9+/=\s]{100,}$/.test(value.idpCertificate)
    ) {
      problem('idpCertificate', 'Paste the certificate, including its BEGIN and END lines.');
    }
  });
export type SamlConnectionInput = z.input<typeof samlConnectionSchema>;

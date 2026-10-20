/**
 * Signing in and keeping an account safe: two-step verification, sessions,
 * single sign-on, changing the address, the picture, and deleting things.
 * The API and the web client read the same numbers here.
 */

/** Where an account lives outside CoreTask. Mirrors the Prisma enum. */
export const IdentityProvider = {
  GOOGLE: 'GOOGLE',
  MICROSOFT: 'MICROSOFT',
  SAML: 'SAML',
} as const;
export type IdentityProvider = (typeof IdentityProvider)[keyof typeof IdentityProvider];
export const IDENTITY_PROVIDERS = Object.values(IdentityProvider);

/** How a session began. Mirrors the Prisma enum. */
export const SignInMethod = {
  PASSWORD: 'PASSWORD',
  GOOGLE: 'GOOGLE',
  MICROSOFT: 'MICROSOFT',
  SAML: 'SAML',
} as const;
export type SignInMethod = (typeof SignInMethod)[keyof typeof SignInMethod];
export const SIGN_IN_METHODS = Object.values(SignInMethod);

/** The two providers anyone can sign in with, as they appear in a path. */
export const SOCIAL_SSO_PROVIDERS = ['google', 'microsoft'] as const;
export type SocialSsoProvider = (typeof SOCIAL_SSO_PROVIDERS)[number];

/** RFC 6238, as every authenticator app expects it: SHA-1, 30 s, six digits. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now a code is still accepted for, to forgive a drifting clock. */
export const TOTP_WINDOW = 1;
/** The name an authenticator app files the code under. */
export const TOTP_ISSUER = 'CoreTask';

/** How long the second step of signing in may take. */
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;
/** How long between showing the QR code and typing the first code. */
export const TWO_FACTOR_SETUP_TTL_SECONDS = 10 * 60;
/** Wrong codes before a sign-in has to start again. */
export const TWO_FACTOR_MAX_ATTEMPTS = 5;
export const TWO_FACTOR_RECOVERY_CODE_COUNT = 10;
/** Recovery codes look like `abcd-efgh-jkmn-pqrs`: 16 characters of an unambiguous alphabet. */
export const TWO_FACTOR_RECOVERY_CODE_PATTERN = /^[a-z2-9]{4}(?:-?[a-z2-9]{4}){3}$/i;

/**
 * An account with neither a password nor two-step verification proves it is
 * them by having signed in this recently.
 */
export const RECENT_SIGN_IN_MINUTES = 15;

/** How long a "confirm your new address" link works, and how often one may be sent. */
export const EMAIL_CHANGE_TTL_HOURS = 24;
export const EMAIL_CHANGE_RESEND_SECONDS = 60;

/** How long a round trip to Google, Microsoft or a SAML provider may take. */
export const SSO_STATE_TTL_SECONDS = 10 * 60;

/** The TXT record that proves a workspace owns a domain holds `coretask-verification=<token>`. */
export const DOMAIN_VERIFICATION_PREFIX = 'coretask-verification=';
export const WORKSPACE_DOMAIN_LIMIT = 20;

/**
 * Profile pictures. The client crops and scales to a square before uploading,
 * so the server only has to bound what arrives. Raster only: an SVG served from
 * the storage origin could carry script.
 */
export const AVATAR_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** The square the client scales a picture to. */
export const AVATAR_SIZE_PX = 256;

/** What has to be typed to delete an account. */
export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';

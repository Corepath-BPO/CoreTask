import type { IdentityProvider, SignInMethod } from '@coretask/contracts';

/**
 * What `POST /auth/login` answers when the account has two-step verification
 * on: no session yet, only a short-lived challenge to present with a code.
 * Signing in with Google, Microsoft or SAML ends the same way.
 */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
  /** Seconds the challenge works for. */
  expiresIn: number;
}

/** `POST /auth/two-factor/verify`: a six-digit code, or one recovery code. */
export interface VerifyTwoFactorPayload {
  challenge: string;
  code: string;
}

/**
 * Proof it is really them, for changes that matter: the password when the
 * account has one; otherwise a code from the authenticator app. An account
 * with neither proves it by having signed in within the last 15 minutes, and
 * sends neither.
 */
export interface ReauthPayload {
  password?: string;
  code?: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

/** The secret, shown once while setting up, as a QR code and as text. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  /** The QR code as an SVG document. Render it as an image, never inline. */
  qrSvg: string;
  /** Hand back with the first code; it carries the secret, sealed. */
  setupToken: string;
}

export interface EnableTwoFactorPayload {
  setupToken: string;
  code: string;
}

/** Shown once. Each works one time in place of a code. */
export interface TwoFactorRecoveryCodes {
  recoveryCodes: string[];
}

/** One signed-in browser or device. */
export interface AccountSession {
  /** The session id; stable while the session lasts. */
  id: string;
  current: boolean;
  method: SignInMethod;
  userAgent: string | null;
  ipAddress: string | null;
  signedInAt: string;
  /** When it last refreshed — about when it was last used. */
  lastActiveAt: string;
  expiresAt: string;
}

export interface RevokeSessionsResult {
  revoked: number;
}

/** `POST /auth/email-change`. */
export interface RequestEmailChangePayload extends ReauthPayload {
  email: string;
}

/** A change waiting for the link sent to the new address. */
export interface PendingEmailChange {
  email: string;
  expiresAt: string;
}

export interface ConfirmEmailChangeResult {
  email: string;
}

/** Which ways in this server offers, for the sign-in page. */
export interface SsoProviders {
  google: boolean;
  microsoft: boolean;
  /** Always true: any workspace may set up its own SAML provider. */
  saml: boolean;
}

export interface SsoRedirect {
  url: string;
}

/** An outside account connected to the caller's. */
export interface LinkedIdentity {
  id: string;
  provider: IdentityProvider;
  /** The address the provider gave at the last sign-in. */
  email: string;
  /** For SAML: the workspace whose provider it is. */
  workspace: { id: string; name: string } | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A workspace's SAML provider, as its admins see it. */
export interface SamlConnection {
  id: string;
  enabled: boolean;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  /** What to enter at the identity provider. */
  serviceProvider: {
    entityId: string;
    acsUrl: string;
    metadataUrl: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSamlConnectionPayload {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  enabled: boolean;
}

export interface WorkspaceDomain {
  id: string;
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  /** The TXT record to publish: at the domain itself, with this value. */
  txtRecord: string;
  createdAt: string;
}

export interface AddWorkspaceDomainPayload {
  domain: string;
}

/** Somewhere to PUT a picture, and the key to confirm it with afterwards. */
export interface AvatarUpload {
  uploadUrl: string;
  /** Send exactly these with the PUT; the signature covers them. */
  headers: Record<string, string>;
  expiresInSeconds: number;
  uploadToken: string;
}

export interface CreateAvatarUploadPayload {
  mimeType: string;
  sizeBytes: number;
}

export interface ConfirmAvatarUploadPayload {
  uploadToken: string;
}

/** What deleting the account would take with it, and what stands in the way. */
export interface AccountDeletionPreview {
  /** Owned, with nobody else in them: deleted along with the account. */
  workspacesDeleted: { id: string; name: string }[];
  /** Owned, with other people in them: hand over or delete these first. */
  workspacesBlocking: { id: string; name: string; memberCount: number }[];
  /** Left, with work assigned to them unassigned. */
  workspacesLeft: { id: string; name: string }[];
  /** What `ReauthPayload` the account will be asked for. */
  reauth: 'password' | 'code' | 'recent-sign-in';
}

export interface DeleteAccountPayload extends ReauthPayload {
  /** Must be `ACCOUNT_DELETION_CONFIRMATION`. */
  confirmation: string;
}

export interface DeleteWorkspacePayload extends ReauthPayload {
  /** Must be the workspace's name, exactly. */
  confirmation: string;
}

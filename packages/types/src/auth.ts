/** Public shape of the authenticated user. Never carries the password hash. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  emailVerified: boolean;
  createdAt: string;
  pronouns: string | null;
  jobTitle: string | null;
  department: string | null;
  aboutMe: string | null;
  /** When they are away, set by them; null when no time off is set. */
  outOfOffice: OutOfOffice | null;
}

/**
 * The answer to "send me a new confirmation link". `sent` is false when the
 * address is already confirmed, or when a link went out under a minute ago.
 */
export interface ResendVerificationResult {
  sent: boolean;
  emailVerified: boolean;
}

/** The address a confirmation link confirmed. */
export interface VerifyEmailResult {
  email: string;
}

/** Calendar days, both ends inclusive, as `yyyy-mm-dd`. */
export interface OutOfOffice {
  from: string;
  until: string;
  note: string | null;
}

/** What `PATCH /users/me` takes; each field left out is left alone. */
export interface UpdateProfilePayload {
  name?: string;
  timezone?: string;
  pronouns?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  aboutMe?: string | null;
  /** Null clears it; the note may be left out. */
  outOfOffice?: { from: string; until: string; note?: string | null } | null;
}

/**
 * Response body of `login` / `register` / `refresh`.
 *
 * Only the short-lived access token is returned in the body — the refresh token
 * travels exclusively in an HTTP-only cookie and is never readable by JS.
 */
export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  /** Access-token lifetime in seconds; the client refreshes ahead of expiry. */
  expiresIn: number;
}

/** Claims embedded in the signed access token. */
export interface AccessTokenPayload {
  /** Subject — the user id. */
  sub: string;
  email: string;
  /** Session id; ties an access token to the refresh-token family that issued it. */
  sid: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  /** Rotation counter, incremented every time the token family is refreshed. */
  ver: number;
  iat?: number;
  exp?: number;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

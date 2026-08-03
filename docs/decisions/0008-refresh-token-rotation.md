# 0008. Rotating refresh tokens in an HTTP-only cookie

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

A dashboard people keep open all day needs sessions that survive reloads without
asking them to sign in repeatedly. The usual approaches each fail somewhere:

- A long-lived JWT in `localStorage` is readable by any XSS payload and cannot be
  revoked before it expires.
- A short-lived token alone means signing in every fifteen minutes.
- A long-lived opaque session cookie is revocable and safe from XSS, but ties
  every request to a session lookup and does not suit non-browser clients.

## Decision

Two tokens with different jobs:

| Token   | Lifetime | Storage                               | Purpose                 |
| ------- | -------- | ------------------------------------- | ----------------------- |
| Access  | 15 min   | Browser memory only                   | Authorises API requests |
| Refresh | 30 days  | HTTP-only cookie, `Path=/api/v1/auth` | Mints new access tokens |

Refresh tokens are **single-use**. Each refresh revokes the presented token and
issues a new one in the same transaction. Rows are grouped by `sessionId` — a
token _family_ representing one device.

Presenting an already-revoked token means it was captured, so the **entire family
is revoked**. Only the SHA-256 hash of each token is stored.

## Alternatives considered

**Long-lived access token, no refresh.** Simple, but unrevocable and maximally
exposed.

**Refresh token without rotation.** Revocable, but a stolen token stays valid for
its full 30 days and its use is indistinguishable from legitimate traffic.
Rotation is what makes theft _detectable_.

**Server-side sessions in Redis.** Instantly revocable and well understood.
Rejected because every request would need a Redis round trip, and because a
stateless access token is what lets non-browser clients and future services
verify a caller without contacting the session store.

**Storing refresh tokens with Argon2.** Argon2 is designed for low-entropy
secrets. A 256-bit random token has nothing to brute-force, so the slow KDF would
cost real latency on every refresh for no security gain. SHA-256 is the right
tool; passwords still use Argon2id.

## Consequences

**Easier**

- XSS cannot read either token: the refresh token is `HttpOnly`, the access token
  exists only in a JS closure that is discarded on reload.
- Theft is detectable. Replay revokes the family, which both stops the attacker
  and signals the user that something happened.
- Revocation is real — logout and reuse-detection both take effect immediately.
- Scoping the cookie to `Path=/api/v1/auth` means it is not attached to any other
  request, so a bug elsewhere cannot echo or log it.
- `TokenService.revokeAllForUser()` already exists, so "sign out everywhere" and
  password-reset invalidation are one controller method away.

**Harder / accepted**

- Clients **must** de-duplicate concurrent refreshes. Several requests can 401 at
  once; if each rotates, the second looks like a replay and kills the session.
  The web client implements a single-flight refresh, and it is documented as a
  client requirement in `docs/api/authentication.md`.
- One database row per issued token. Bounded by `purgeExpired()`, which a
  scheduled job will call.
- A false positive logs a legitimate user out. Accepted deliberately: an
  unnoticed session hijack is worse than one extra sign-in.
- A reload always costs one `/auth/refresh` round trip before the app can render.
- Cross-site deployments need `SameSite=None` with HTTPS; the environment schema
  refuses that combination without TLS.

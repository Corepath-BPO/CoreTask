# Authentication

Base URL: `/api/v1`. Interactive reference: `/api/docs`.

## Model

Two tokens with different lifetimes, storage and jobs:

| Token   | Lifetime | Where it lives                 | Sent as                       |
| ------- | -------- | ------------------------------ | ----------------------------- |
| Access  | 15 min   | Browser memory only            | `Authorization: Bearer <jwt>` |
| Refresh | 30 days  | HTTP-only cookie `coretask_rt` | Automatically, `/auth` only   |

The access token is never written to `localStorage` or `sessionStorage`, so an
XSS payload that reads storage finds nothing. It is short-lived, so a token
captured some other way expires quickly.

The refresh token is long-lived, which is exactly why JavaScript can never touch
it: `HttpOnly`, `SameSite`, `Secure` in production, and scoped to
`Path=/api/v1/auth` so it is not attached to any other request.

## Endpoints

| Method | Path             | Auth           | Purpose                            |
| ------ | ---------------- | -------------- | ---------------------------------- |
| POST   | `/auth/register` | none           | Create an account, start a session |
| POST   | `/auth/login`    | none           | Exchange credentials for a session |
| POST   | `/auth/refresh`  | refresh cookie | Rotate and mint a new access token |
| POST   | `/auth/logout`   | refresh cookie | Revoke the current session         |
| GET    | `/auth/me`       | access token   | Return the authenticated user      |

### POST /auth/register

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "CoreTask!2024" }
```

`201` with `Set-Cookie: coretask_rt=…; HttpOnly; Path=/api/v1/auth; SameSite=Lax`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "019fc880-7e46-71f2-bf49-0f370a7e3a5e",
      "email": "ada@example.com",
      "name": "Ada Lovelace",
      "avatarUrl": null,
      "timezone": "UTC",
      "emailVerified": false,
      "createdAt": "2026-08-04T09:12:44.201Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "expiresIn": 900
  },
  "meta": null
}
```

Password policy: 10–128 characters using at least three of lowercase, uppercase,
number, symbol. Length carries most of the entropy, so the class requirement is
kept lenient rather than the classic "must contain a symbol" rule that pushes
people toward `Password1!`.

### POST /auth/login

`401 INVALID_CREDENTIALS` for both a wrong password and an unknown address, and
the unknown-account path performs a real Argon2 verification against a throwaway
hash so response time does not reveal which addresses are registered.

A disabled account gets `403 ACCOUNT_DISABLED` — that is a deliberate exception,
because the user needs to know to contact an administrator.

### POST /auth/refresh

Takes no body; reads the cookie. Returns a new access token and **rotates** the
cookie.

### POST /auth/logout

Revokes the presented token's family and clears the cookie. Safe to call without
a session. Other sessions of the same user are untouched — signing out on a
laptop must not sign you out on a phone.

### GET /auth/me

Re-reads the user from the database on every call, so a disabled account stops
working immediately rather than at the next token expiry.

## Rotation and replay detection

Refresh tokens are single-use. Each rotation revokes the presented token and
issues a new one, both in one transaction — a crash between the two would
otherwise leave the session either dead or replayable.

Rows are grouped by `sessionId`, a **token family** representing one device:

```
login ──► token v1 ──rotate──► token v2 ──rotate──► token v3
              │                    │                    │
           revoked              revoked              active
```

Presenting an already-revoked token means it was captured — the legitimate client
has moved on. The response is `401 REFRESH_TOKEN_REUSED` and the **entire family
is revoked**, so both the attacker and the real user must sign in again. That is
the intended outcome: an unnoticed session hijack is worse than one extra login.

Only the SHA-256 hash of each token is stored. SHA-256 rather than Argon2 because
the token already carries 256+ bits of entropy; the hash exists so a database
leak cannot be replayed. Passwords, which have low entropy, use Argon2id
(19 MiB, t=2, p=1 — the OWASP recommendation).

## Client responsibilities

1. Send `credentials: 'include'` so the cookie travels.
2. Keep the access token in memory, never in storage.
3. On boot, call `/auth/refresh` once to restore the session.
4. On `401 ACCESS_TOKEN_EXPIRED`, refresh once and retry.
5. **De-duplicate concurrent refreshes.** Several requests can 401 at once; if
   each triggers its own rotation, the second looks like a replay and revokes the
   session. `web/src/lib/api/client.ts` implements this single-flight.

## Error codes

| Code                       | Status | Meaning                                     |
| -------------------------- | ------ | ------------------------------------------- |
| `VALIDATION_FAILED`        | 422    | Field errors in `error.details.fields`      |
| `EMAIL_ALREADY_REGISTERED` | 409    | Address already in use                      |
| `INVALID_CREDENTIALS`      | 401    | Wrong password **or** unknown address       |
| `UNAUTHORIZED`             | 401    | No access token supplied                    |
| `ACCESS_TOKEN_EXPIRED`     | 401    | Refresh and retry                           |
| `ACCESS_TOKEN_INVALID`     | 401    | Malformed or wrongly signed — sign in again |
| `REFRESH_TOKEN_INVALID`    | 401    | Missing or unparseable refresh cookie       |
| `REFRESH_TOKEN_EXPIRED`    | 401    | Past its 30-day life                        |
| `REFRESH_TOKEN_REUSED`     | 401    | Replay detected; the family was revoked     |
| `ACCOUNT_DISABLED`         | 403    | Account deactivated                         |
| `RATE_LIMIT_EXCEEDED`      | 429    | Auth throttle tripped                       |

Branch on `error.code`. `error.message` is human-facing copy and may change.

## Cookie configuration

| Setting    | Development    | Production         |
| ---------- | -------------- | ------------------ |
| `HttpOnly` | yes            | yes                |
| `Secure`   | no             | yes (forced)       |
| `SameSite` | `lax`          | `COOKIE_SAME_SITE` |
| `Path`     | `/api/v1/auth` | `/api/v1/auth`     |
| `Domain`   | unset          | `COOKIE_DOMAIN`    |

`localhost:5173` → `localhost:3000` is _same-site_ (ports do not affect
same-site), so `Lax` works in development. It also works when the client and API
share a registrable domain (`app.example.com` / `api.example.com`). Only a truly
cross-site deployment needs `SameSite=None`, which the environment schema then
requires to be paired with HTTPS.

## Rate limiting

Two ceilings, and which one applies depends on whether the endpoint accepts a
password:

| Endpoint                                    | Limit                 | Default |
| ------------------------------------------- | --------------------- | ------- |
| `/auth/login`, `/auth/register`             | `AUTH_RATE_LIMIT_MAX` | 10/60s  |
| `/auth/refresh`, `/auth/logout`, `/auth/me` | `RATE_LIMIT_MAX`      | 120/60s |
| Everything else                             | `RATE_LIMIT_MAX`      | 120/60s |

Exceeding either returns `429 RATE_LIMIT_EXCEEDED`.

The strict ceiling exists to slow password guessing, so it belongs only where a
password is submitted. `/auth/refresh` authenticates with an HTTP-only cookie an
attacker cannot read, and a replayed token already revokes its whole family, so
guess-rate limiting buys nothing there — while costing real users a lot: every
tab calls `/auth/refresh` on load, so a handful of open tabs or reloads used to
trip the strict limit and sign the user out of a perfectly valid session.

Running the browser e2e suite signs in far more often in a minute than a person
would. Raise `AUTH_RATE_LIMIT_MAX` (100 is plenty) for that run, or the suite
throttles itself.

The store is in-memory, so the limit is per API instance. Moving it to Redis is
the next step before running more than one replica.

## Session restore on page load

The access token is held in memory only, so a reload starts with nothing and the
app exchanges the refresh cookie for a new one. Two details matter:

- **Routing waits for that exchange.** `AppRouter` holds the router mount while
  the restore is in flight. The protected route's `beforeLoad` reads the auth
  store synchronously and does not re-run when the store later settles, so
  mounting first would bounce a signed-in user to `/login` and leave them there.
- **A hint avoids a pointless request.** `lib/api/session-hint` records whether
  this browser is known signed-out, so anonymous visits skip a call that could
  only ever 401. Absent means _unknown_, and unknown still tries — treating it as
  signed out would strand every session that predates the marker.

## Not yet implemented

E-mail verification, password reset, "sign out everywhere", and MFA. The
groundwork exists — `emailVerifiedAt` on the user, the e-mail queue and worker,
and `TokenService.revokeAllForUser()`, which is one controller method away from
being a `/auth/logout-all` endpoint.

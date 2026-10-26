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

| Method | Path                              | Auth           | Purpose                                  |
| ------ | --------------------------------- | -------------- | ---------------------------------------- |
| POST   | `/auth/register`                  | none           | Create an account, start a session       |
| POST   | `/auth/login`                     | none           | Exchange credentials for a session       |
| POST   | `/auth/refresh`                   | refresh cookie | Rotate and mint a new access token       |
| POST   | `/auth/logout`                    | refresh cookie | Revoke the current session               |
| POST   | `/auth/logout-all`                | access token   | Revoke every session, this one included  |
| GET    | `/auth/me`                        | access token   | Return the authenticated user            |
| POST   | `/auth/change-password`           | access token   | New password; other sessions signed out  |
| POST   | `/auth/forgot-password`           | none           | E-mail a link to set a new password      |
| POST   | `/auth/reset-password`            | none           | Set a new password from that link        |
| POST   | `/auth/resend-verification`       | access token   | E-mail a new link to confirm the address |
| POST   | `/auth/verify-email`              | none           | Confirm the address from that link       |
| POST   | `/auth/two-factor/verify`         | none           | Second step of signing in: a code        |
| GET    | `/auth/two-factor`                | access token   | Whether two-step verification is on      |
| POST   | `/auth/two-factor/setup`          | access token   | A new secret, as a QR code               |
| POST   | `/auth/two-factor/enable`         | access token   | Turn it on with the first code           |
| POST   | `/auth/two-factor/disable`        | access token   | Turn it off (confirm it is you)          |
| POST   | `/auth/two-factor/recovery-codes` | access token   | Replace the recovery codes               |
| GET    | `/auth/sessions`                  | access token   | The account's open sessions              |
| DELETE | `/auth/sessions/:sessionId`       | access token   | Sign out one other session               |
| POST   | `/auth/sessions/revoke-others`    | access token   | Sign out every session but this one      |
| GET    | `/auth/email-change`              | access token   | The change waiting for its link          |
| POST   | `/auth/email-change`              | access token   | Ask to move to a new address             |
| DELETE | `/auth/email-change`              | access token   | Cancel the waiting change                |
| POST   | `/auth/email-change/confirm`      | none           | Use the link sent to the new address     |

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

With two-step verification on, a right password answers
`200 { twoFactorRequired: true, challenge, expiresIn: 300 }` and sets **no**
cookie; see [Two-step verification](#two-step-verification). An account that
signs in only with SSO has no password, and a password sign-in to it is
`401 INVALID_CREDENTIALS` like any other wrong password.

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

### POST /auth/forgot-password

`{ email }`. Always `202 { sent: true }`, whether or not the address has an
account, so the answer cannot be used to find out who does. When it is an
active person's account, a link to `<WEB_URL>/reset-password?token=…` is
e-mailed: it works once, for an hour. A new request replaces an unused link,
and at most one link is sent per account a minute. Only the token's SHA-256
hash is stored; the queued e-mail job is removed once sent.

### POST /auth/reset-password

`{ token, password }`, the password held to the registration policy. `204` on
success; every session the account had is revoked, so it signs in again.
`400 PASSWORD_RESET_INVALID` for a link that is unknown, used or expired. The
web page takes the token out of the address bar as soon as it reads it. Using
the link also confirms the address, since it was mailed there.

### POST /auth/logout-all

"Sign out everywhere", from **Settings › Sign-in and security**. Revokes every
refresh token the account has, this session's included, and clears the cookie:
`200 { loggedOut: true }`. Access tokens already handed out stop working at
their next request: every request checks that the session its token names is
still open, and answers `401 ACCESS_TOKEN_EXPIRED` once it is not — the client
refreshes, the refresh fails, and it lands on the sign-in page.

### POST /auth/change-password

`{ currentPassword, newPassword }`, the new one held to the registration policy
and refused if it is the current one (`422`). `204` on success. Every _other_
session is revoked; the one that made the change stays signed in. Any unused
reset link is voided, since it would undo the change. A wrong current password
is `400 CURRENT_PASSWORD_INCORRECT` rather than a 401, so the client does not
mistake it for an expired session.

### E-mail confirmation

Registering queues one e-mail, "Welcome to CoreTask — confirm your e-mail
address", with a link to `<WEB_URL>/verify-email?token=…`. The link works once,
for 72 hours, and only for the address it was sent to. As with reset links,
only the token's SHA-256 hash is stored and the queued job is removed once
sent. Accepting a workspace invitation or using a reset link also confirms the
address, since both were mailed there.

- `POST /auth/resend-verification` sends a new link, replacing any unused one.
  It answers `{ sent, emailVerified }`: nothing is sent when the address is
  already confirmed, or when a link went out under a minute ago.
- `POST /auth/verify-email` with `{ token }` answers `{ email }`, or
  `400 EMAIL_VERIFICATION_INVALID` for a link that is unknown, used, expired,
  or for an address the account no longer has. It needs no session, because
  the link may be opened on another device.

A confirmed address is required in two ways:

- **From the start**, for actions that mail other people or hand out access:
  sending workspace and project invitations, creating API keys, webhooks,
  project apps and OAuth apps, and installing Slack. Each answers
  `403 EMAIL_NOT_VERIFIED` until the address is confirmed (routes marked
  `@RequireVerifiedEmail()`).
- **After a deadline**, for everything else. A new account has
  `EMAIL_VERIFICATION_GRACE_DAYS` (default 7) to confirm; `AuthUser`
  carries the deadline as `emailVerificationDueAt`. Past it, every route
  answers `403 EMAIL_NOT_VERIFIED` except the ones that fix it — the `/auth`
  routes (confirming, resending, changing the address, sessions, signing out)
  and `/users/me` (routes marked `@AllowUnverifiedEmail()`). The web app shows a
  gate in place of the app with **Send a new link**, **I have confirmed it**
  and **change it**. Accounts that existed before this was introduced got a
  week from the migration, not from when they signed up.

Only sessions are held to it: an API key's service account has no inbox, and
an OAuth token acts for a person who deals with it in their own session. Until
the deadline the web app shows a dismissible reminder naming the date, and
**Settings › Sign-in and security** shows the state.

### Two-step verification

An authenticator app (TOTP, RFC 6238: SHA-1, 30-second steps, six digits),
with ten single-use recovery codes. Turned on and off from
**Settings › Sign-in and security**.

1. `POST /auth/two-factor/setup` answers `{ secret, otpauthUrl, qrSvg, setupToken }`.
   Nothing is saved: the secret travels inside the sealed `setupToken`
   (10 minutes).
2. `POST /auth/two-factor/enable` with `{ setupToken, code }` saves the secret —
   AES-256-GCM encrypted, under a key derived from
   `WEBHOOK_SECRET_ENCRYPTION_KEY` — and answers `{ recoveryCodes }`, the only
   time they are readable. Only their SHA-256 hashes are kept.

Signing in then takes two requests. The password (or Google, Microsoft or
SAML) earns a sealed challenge that works for five minutes;
`POST /auth/two-factor/verify` with `{ challenge, code }` turns it into a
session exactly as `login` would. `code` is six digits from the app — one step
of clock drift either way is forgiven — or a recovery code in any case or
spacing. Each app code is accepted once (the step it matched is stored, and
earlier steps are refused) and each recovery code is spent when used. Five
wrong codes end a challenge (`401 TWO_FACTOR_CHALLENGE_INVALID`); twenty wrong
codes in 15 minutes stop the account's codes for the rest of that window
(`429`), wherever they come from.

`disable` and `recovery-codes` need the account to confirm it is you (below).
Turning it on or off e-mails a notice to the account's address.

### Confirming it is you

Turning two-step verification off, replacing recovery codes, changing the
address and deleting the account or a workspace take a `ReauthPayload` in the
body: `{ password }` when the account has one; otherwise `{ code }` from the
authenticator app; and an account with neither — it signs in only through
Google, Microsoft or SAML — sends nothing, and is accepted only if this
session began in the last 15 minutes (`403 RECENT_SIGN_IN_REQUIRED` otherwise:
sign in again). A missing proof is `400 REAUTH_REQUIRED`; a wrong password
`400 CURRENT_PASSWORD_INCORRECT`; a wrong code `400 TWO_FACTOR_CODE_INVALID`.

### Sessions

Each sign-in starts a session — a refresh-token family — that remembers the
browser it came from, its IP address, how it began (`PASSWORD`, `GOOGLE`,
`MICROSOFT`, `SAML`) and when. `GET /auth/sessions` lists the open ones, newest
activity first, with `current` on the one asking. `DELETE /auth/sessions/:id`
signs out one other session (`400 SESSION_IS_CURRENT` for this one — sign out
instead); `POST /auth/sessions/revoke-others` signs out all the rest and
answers `{ revoked }`. Either way the session stops at its next request, as
with signing out everywhere. **Settings › Where you are signed in** lists them.

### Changing the e-mail address

`POST /auth/email-change` with `{ email, …ReauthPayload }` sends a link to the
**new** address (`<WEB_URL>/confirm-email-change?token=…`, 24 hours, once) and
a notice to the current one; `202` with `{ email, expiresAt }`. Nothing changes
until the link is used: `POST /auth/email-change/confirm` with `{ token }` —
public, since the new inbox may be on another device — moves the account,
marks the new address confirmed, voids reset and confirmation links mailed to
the old one, and tells the old address it is done. A new request replaces a
waiting one, at most one a minute (`429`). `409 EMAIL_ALREADY_REGISTERED` when
the address belongs to another account, at either step.

### Profile picture

Uploaded the way attachments are: the browser sends the bytes to storage
itself, and the API looks at what arrived before it counts. The web app crops
to a square, scales to 256 px and re-encodes as WebP (PNG where the browser
cannot) first, so the server only bounds what arrives: PNG, JPEG, WebP or GIF,
at most 2 MB.

1. `POST /users/me/avatar` with `{ mimeType, sizeBytes }` answers
   `{ uploadUrl, headers, expiresInSeconds, uploadToken }`. PUT the bytes to
   `uploadUrl` with exactly `headers` (the content type is signed). The token
   is sealed, lasts 15 minutes and names the storage key, which the client
   never chooses: `avatars/<userId>/<uuid>.<ext>`.
2. `POST /users/me/avatar/confirm` with `{ uploadToken }` reads the object
   back. Over the limit is `400 PAYLOAD_TOO_LARGE`, another type than declared
   `400 UNSUPPORTED_MEDIA_TYPE`, and either way the object is deleted. On
   success it answers the `AuthUser`, deletes the previous picture and any
   upload that was never confirmed.

`DELETE /users/me/avatar` clears it (and works for a picture from anywhere).
`avatarUrl` — the field every projection already carries — becomes
`<API_URL>/api/v1/users/<id>/avatar?v=<version>`: public, unthrottled, a `302`
to a signed URL that lasts five minutes, cached privately for four, with
`Cross-Origin-Resource-Policy: cross-origin` so the web app's origin may show
it. `404` when there is no uploaded picture. A new picture is a new `v`.

### Deleting the account

`GET /users/me/deletion` previews it:

- `workspacesDeleted` — owned, and no other person in them (an API key's
  account does not count): deleted with the account.
- `workspacesBlocking` — owned, with other people (`memberCount` counts people,
  the owner included). These stop the deletion until they are handed over
  (`transfer-ownership`) or deleted.
- `workspacesLeft` — the rest: left exactly as **Leave workspace** would, so
  open tasks and tickets assigned to them are unassigned and they come off
  team, project and follower lists. Closed work keeps them as its assignee.
- `reauth` — which proof the deletion will ask for.

`DELETE /users/me` with `{ confirmation: "DELETE", …ReauthPayload }` answers
`204` and clears the refresh cookie. In order: anything but `DELETE` typed
back is `400 CONFIRMATION_MISMATCH`; then the proof (above); then
`409 ACCOUNT_OWNS_SHARED_WORKSPACES`, with the blocking workspaces in
`error.details.workspaces`. Then the owned workspaces are deleted as below,
the others left, and the row is **scrubbed, not deleted**, so what the person
wrote keeps an author:

- e-mail becomes `deleted+<id>@deleted.coretask.invalid` (a reserved TLD no
  mail is ever sent to), name `Deleted user`; password, picture (and its
  file), profile, time off, two-step secret and e-mail confirmation are
  cleared; `isActive = false`, `deletedAt` set.
- Deleted outright: sessions, linked Google/Microsoft/SAML identities,
  recovery codes, e-mail change, confirmation and reset links, OAuth codes
  and grants, OAuth apps they registered, Slack account links, calendar
  links, notifications and notification settings, Home layouts, saved
  searches, My Tasks placements, personal views, project and portfolio stars,
  portfolio capacity, and any follower, team, project or non-owner workspace
  membership left over.
- Kept, under "Deleted user": tasks and tickets they created or reported,
  closed work assigned to them, comments, likes and mentions, messages and
  replies, status updates, activity, time entries, goals, portfolios,
  dashboards, shared views, fields, tags, templates, rules, and the API keys
  and webhooks they set up for a workspace.

A last notice goes to the old address. Access tokens already issued stop at
their next request; the old address no longer signs in, and may register a
new account at once.

### Deleting a workspace

`DELETE /workspaces/:id` — the owner only (`403` for anyone else), in a
session (`403 API_KEY_NOT_ALLOWED` for a key) — with
`{ confirmation: "<the workspace name, exactly>", …ReauthPayload }` answers
`204`. A name that does not match is `400 CONFIRMATION_MISMATCH`, checked
before the proof.

Nearly all of it is the database's work: every table that belongs to a
workspace hangs off it with `ON DELETE CASCADE`, so one `DELETE` takes
projects, sections, tasks, comments, attachments, fields, rules and their
runs, tickets, goals, portfolios, teams, tags, views, forms, webhooks and
their deliveries, API keys, invitations, the Slack installation, the SAML
connection and domains, and everyone's notifications, stars, placements and
settings in it. `workspace-deletion.e2e-spec.ts` fills a workspace with one of
each and checks that every table is back to its count before the workspace
existed. Around that `DELETE`:

- the hidden accounts behind its API keys are deleted too — each only ever
  acted there — or switched off if anything elsewhere still names one;
- Slack's bot token is revoked first, where it can still be read;
- every member's open sockets are taken out of the workspace's room;
- its files are deleted from storage in batches, best effort, including
  anything else under `workspaces/<id>/`;
- the other people in it get a short e-mail saying who deleted it.

### Single sign-on

People sign in with Google, Microsoft or their workspace's own SAML identity
provider, beside a password or instead of one. However they arrive, it ends in
`AuthService.completeSignIn`, as a password does: a session, or with two-step
verification on, a challenge. Setting the providers up:
[integrations/sso.md](../integrations/sso.md).

| Method         | Path                                                | Auth                  | Purpose                                  |
| -------------- | --------------------------------------------------- | --------------------- | ---------------------------------------- |
| GET            | `/auth/sso/providers`                               | none                  | `{ google, microsoft, saml }`            |
| GET            | `/auth/sso/:provider/start?redirect=`               | none (navigated to)   | Off to Google or Microsoft               |
| GET            | `/auth/sso/:provider/callback`                      | `coretask_sso` cookie | Where the provider sends the browser     |
| POST           | `/auth/sso/:provider/link`                          | access token          | `{ url }` to connect it to this account  |
| GET            | `/auth/sso/saml/start?workspace=` or `?email=`      | none (navigated to)   | Off to the workspace's identity provider |
| POST           | `/auth/sso/saml/link/:workspaceId`                  | access token, member  | `{ url }` to connect it to this account  |
| POST           | `/auth/sso/saml/:connectionId/acs`                  | a signed response     | The provider's form post; 303 to finish  |
| GET            | `/auth/sso/saml/finish?result=`                     | `coretask_sso` cookie | Matches the response to this browser     |
| GET            | `/auth/sso/saml/:connectionId/metadata`             | none                  | SP metadata; its URL is the entity ID    |
| GET            | `/auth/sso/identities`                              | access token          | The accounts connected to this one       |
| DELETE         | `/auth/sso/identities/:identityId`                  | access token          | Disconnect one                           |
| GET/PUT/DELETE | `/workspaces/:workspaceId/saml`                     | admin or owner        | The workspace's SAML connection          |
| GET/POST       | `/workspaces/:workspaceId/domains`                  | admin or owner        | Claimed domains and their TXT records    |
| DELETE         | `/workspaces/:workspaceId/domains/:domainId`        | admin or owner        | Remove a domain                          |
| POST           | `/workspaces/:workspaceId/domains/:domainId/verify` | admin or owner        | Look the TXT record up now               |

**The round trip.** `start` (and `link`) sets `coretask_sso` — HTTP-only,
`SameSite=Lax`, `Path=/api/v1/auth/sso`, ten minutes — holding, AES-256-GCM
encrypted, the OIDC `state`, `nonce` and PKCE verifier or the SAML RelayState,
the `redirect` path, and whether this is a sign-in or a connection. The return
is refused unless that cookie is there and matches; it is spent either way.
Every ending is a redirect to the web app, never a page from the API:

- **Signed in:** the refresh cookie is set, then
  `<WEB_URL>/sso/complete?redirect=<path>`, where the app's usual restore
  picks the session up.
- **Two-step verification on:** no cookie, and
  `<WEB_URL>/sso/complete?redirect=<path>#challenge=<challenge>`. In the
  fragment, the challenge reaches neither a server log nor a Referer; the page
  asks for the code and finishes at `POST /auth/two-factor/verify`.
- **Refused:** `<WEB_URL>/login?ssoError=<code>` — or `/settings?ssoError=<code>`
  when connecting. Connected: `/settings?ssoLinked=<google|microsoft|saml>`.

`redirect` must be a path on the web app; anything else — another host,
`//host`, `/\host` — becomes `/`.

**Google and Microsoft** use the authorization code flow with PKCE (S256), a
nonce and a state. The code is exchanged at the token endpoint with the client
secret, and the ID token's issuer, audience, expiry, issue time and nonce are
checked. Its signature is not: OpenID Connect Core 3.1.3.7 allows that for a
token received straight from the token endpoint over TLS. The person is the
provider's subject — Google's `sub`, Microsoft's `<tid>:<oid>` — never the
address, which can change hands. Who is signed in:

1. the account already connected to that subject;
2. else, when the provider vouches for the address — Google's `email_verified`;
   Microsoft's `xms_edov`, or any personal Microsoft account — the account
   with that address, which is connected now, or a new account with no
   password. An existing account must have confirmed its address first
   (`SSO_ACCOUNT_UNCONFIRMED`): anyone can register someone else's address
   and wait for its owner to arrive by SSO, and confirming — or a reset link,
   which signs out every session — is what makes the account its owner's;
3. else `SSO_EMAIL_UNVERIFIED`: sign in another way and connect it from
   Settings, where the address need not be vouched for.

**SAML**, one connection per workspace. CoreTask sends an AuthnRequest
(HTTP-Redirect binding) and accepts only a response to a request it made, and
only once (`InResponseTo`, kept in Redis), whose assertion is signed with the
configured certificate, for CoreTask's entity ID, from the configured issuer.
The provider posts to the ACS from its own site, which a Lax cookie does not
travel with, so the ACS only checks the response and seals the verdict into a
`303` to `finish`: a top-level GET, which does carry the cookie, and where the
RelayState must match it. Who is signed in: the person connected to that
NameID, while still a member of the workspace; else, when the workspace has
verified the address's domain, the account with that address (once it has
confirmed it, as above) — made a member of the workspace — or a new one; else
`SSO_ACCOUNT_NOT_FOUND`.

**Domains.** `POST /workspaces/:id/domains` with `{ domain }` answers the TXT
record to publish at the domain, `coretask-verification=<token>`;
`…/verify` looks it up. One workspace at most verifies a domain
(`409 DOMAIN_ALREADY_VERIFIED`); `400 DOMAIN_VERIFICATION_FAILED` while the
record is not there; twenty per workspace.

**Connected accounts.** One per provider — per workspace, for SAML — and
connecting another replaces it. Connecting one, by hand or by its address,
e-mails a notice, as does disconnecting. Disconnecting the only way into an
account with no password is refused (`409 SSO_LAST_SIGN_IN_METHOD`); a reset
link from "Forgot password?" sets a first password.

The codes the web app is sent back with: `SSO_NOT_CONFIGURED`, `SSO_FAILED`,
`SSO_EMAIL_UNVERIFIED`, `SSO_ACCOUNT_NOT_FOUND`, `SSO_ACCOUNT_UNCONFIRMED`,
`SSO_IDENTITY_IN_USE`,
`SAML_NOT_CONFIGURED`, `ACCOUNT_DISABLED` and `WORKSPACE_ACCESS_DENIED`. It
shows `ERROR_CODE_MESSAGES[code]` for each.

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
   session. `webapp/src/lib/api/client.ts` implements this single-flight.

## Error codes

| Code                           | Status | Meaning                                       |
| ------------------------------ | ------ | --------------------------------------------- |
| `VALIDATION_FAILED`            | 422    | Field errors in `error.details.fields`        |
| `EMAIL_ALREADY_REGISTERED`     | 409    | Address already in use                        |
| `INVALID_CREDENTIALS`          | 401    | Wrong password **or** unknown address         |
| `UNAUTHORIZED`                 | 401    | No access token supplied                      |
| `ACCESS_TOKEN_EXPIRED`         | 401    | Refresh and retry                             |
| `ACCESS_TOKEN_INVALID`         | 401    | Malformed or wrongly signed — sign in again   |
| `REFRESH_TOKEN_INVALID`        | 401    | Missing or unparseable refresh cookie         |
| `REFRESH_TOKEN_EXPIRED`        | 401    | Past its 30-day life                          |
| `REFRESH_TOKEN_REUSED`         | 401    | Replay detected; the family was revoked       |
| `ACCOUNT_DISABLED`             | 403    | Account deactivated                           |
| `PASSWORD_RESET_INVALID`       | 400    | Reset link unknown, used or expired           |
| `CURRENT_PASSWORD_INCORRECT`   | 400    | Changing a password: the current one is wrong |
| `EMAIL_VERIFICATION_INVALID`   | 400    | Confirmation link unknown, used or expired    |
| `EMAIL_NOT_VERIFIED`           | 403    | Confirm the address first                     |
| `EMAIL_CHANGE_INVALID`         | 400    | New-address link unknown, used or expired     |
| `REAUTH_REQUIRED`              | 400    | Send the password (or a code) to confirm      |
| `RECENT_SIGN_IN_REQUIRED`      | 403    | No password or 2FA: sign in again first       |
| `TWO_FACTOR_CODE_INVALID`      | 400    | Wrong, reused or spent code                   |
| `TWO_FACTOR_CHALLENGE_INVALID` | 401    | Sign-in challenge expired or used up          |
| `TWO_FACTOR_SETUP_INVALID`     | 400    | Setup token expired; start again              |
| `TWO_FACTOR_ALREADY_ENABLED`   | 409    | Already on                                    |
| `TWO_FACTOR_NOT_ENABLED`       | 400    | Not on                                        |
| `SESSION_IS_CURRENT`           | 400    | That is this session; sign out instead        |
| `RATE_LIMIT_EXCEEDED`          | 429    | Auth throttle tripped                         |

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

## API keys (integrations)

A workspace admin creates keys under **Integrations → API keys**. A key is the
credential for a tool such as n8n, and it is the only way for one: the refresh
cookie is bound to a browser session and never issued to a machine.

| Property   | Value                                                               |
| ---------- | ------------------------------------------------------------------- |
| Format     | `ctk_` + 43 URL-safe characters (32 random bytes)                   |
| Sent as    | `X-API-Key: ctk_…` or `Authorization: Bearer ctk_…`                 |
| Storage    | SHA-256 hash only; the raw key is returned once, at creation        |
| Identity   | A hidden service-account user named after the key, in one workspace |
| Role       | `GUEST`, `MEMBER` or `MANAGER` — never `ADMIN` or `OWNER`           |
| Lifetime   | Optional expiry in days; revocation is final and keeps the history  |
| Rate limit | `RATE_LIMIT_MAX` per key, not per IP                                |

The service account is a real `User` row (`isServiceAccount`), so tasks and
comments it creates carry it as author and the activity feed reads "n8n created
this task". It is left out of member lists and counts, cannot sign in, and its
address is under the reserved `.invalid` TLD so no mail can ever reach it.

A key may move work but never widen its own access. Routes marked
`@SessionOnly()` refuse it with `403 API_KEY_NOT_ALLOWED`: everything under
`/auth`, managing members, invitations and API keys, and creating workspaces.
Any workspace other than its own answers `403 WORKSPACE_ACCESS_DENIED`.

Start with `GET /integration/whoami`, which confirms the key and returns the
workspace id every other call needs:

```json
{
  "principal": "api_key",
  "user": { "id": "…", "name": "n8n", "email": "api-key-…@integrations.coretask.invalid" },
  "workspace": { "id": "…", "name": "CoreTask Demo", "slug": "coretask-demo" },
  "apiKey": { "id": "…", "name": "n8n", "role": "MEMBER" }
}
```

| Code                       | Status | Meaning                                       |
| -------------------------- | ------ | --------------------------------------------- |
| `API_KEY_INVALID`          | 401    | Not recognised                                |
| `API_KEY_REVOKED`          | 401    | Revoked by an admin                           |
| `API_KEY_EXPIRED`          | 401    | Past its expiry                               |
| `API_KEY_NOT_ALLOWED`      | 403    | Session-only route                            |
| `API_KEY_ROLE_NOT_ALLOWED` | 422    | Asked for a role a key may not hold           |
| `API_KEY_LIMIT_REACHED`    | 409    | Workspace already has the maximum active keys |

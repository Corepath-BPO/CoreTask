# OAuth apps and webhook subscriptions

How another tool connects to CoreTask on someone's behalf, the way Zapier,
Make or a custom connector connects to Asana.

Three credentials reach the API:

| Credential         | Header                              | Acts as                                                           | Made in                 |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| Session            | `Authorization: Bearer eyJ…`        | The signed-in person                                              | Logging in              |
| API key            | `X-API-Key: ctk_…` or `Bearer ctk_` | A service account in one workspace                                | Integrations › API keys |
| OAuth access token | `Authorization: Bearer cto_…`       | The person who allowed the app, in every workspace they belong to | The flow below          |

`JwtAuthGuard` tells them apart by prefix. Routes marked `@SessionOnly()` —
people, API keys, webhooks in Settings, workspaces, OAuth apps, consent, the
session — refuse an API key (`API_KEY_NOT_ALLOWED`) and an OAuth token
(`OAUTH_TOKEN_NOT_ALLOWED`) alike, so neither can widen its own reach.

## The authorization-code flow

1. A developer registers an app under **Integrations › OAuth apps**
   (`/users/me/oauth-apps`). They get a public client id (`ctc_…`) and a
   client secret (`cts_…`, shown once). Redirect URIs are https, or http on
   localhost, without a fragment, and are matched exactly.
2. The tool sends the person to the web app's `/oauth/authorize` with
   `client_id`, `redirect_uri`, `response_type=code`, a `state`, and
   optionally `code_challenge` + `code_challenge_method=S256` (PKCE). The page
   asks `POST /oauth/consent` whether the request checks out — a known client
   and a registered URI — and shows a problem, never a redirect, if not. It
   refuses to run inside a frame.
3. The person clicks **Allow** (`POST /oauth/authorize`). The API answers the
   redirect URI with a one-time `code` (10 minutes) and the `state`; **Cancel**
   answers `error=access_denied`.
4. The tool posts to `POST /api/v1/oauth/token` with `grant_type=authorization_code`,
   the code, the same `redirect_uri`, the `code_verifier` if it sent a
   challenge, and its client id and secret (form body or HTTP Basic). It gets
   an access token (`cto_…`, 1 hour) and a refresh token (`ctr_…`).
5. `grant_type=refresh_token` returns a new access token. A server-side app's
   refresh token is not rotated, as Asana's are not.

### Public clients (mobile and desktop apps)

An app registered as **Mobile or desktop app** (`clientType: public`, fixed at
registration) is a public client (RFC 6749 §2.1): its code is in every copy
of it, so it is given **no secret**.

- Every authorization must carry a PKCE `code_challenge` (S256); a request
  without one is refused on the consent page.
- The token endpoint takes its `client_id` alone (`token_endpoint_auth_method
none`) and the `code_verifier`; a code without a challenge is refused.
- Each refresh **replaces the refresh token** (RFC 9700 §4.14), swapped
  atomically, so a stolen one works at most once and two racing refreshes
  cannot both win. The response carries the new `refresh_token`.
- It may register a private-use redirect scheme — reverse-domain, with a dot:
  `com.example.app:/oauth/callback` (RFC 8252 §7.1) — as well as https and
  loopback http. A server-side app may not.
- Revocation takes its `client_id` alone. There is no secret to replace.

The token and revocation endpoints speak RFC 6749 / RFC 7009 — top-level
`access_token`, errors as `{ error, error_description }`, `Cache-Control:
no-store` — rather than CoreTask's envelope, because that is what OAuth client
libraries read.

### Storage and revocation

Everything is stored hashed (SHA-256): secrets, codes, refresh and access
tokens. `oauth_grants` is one person's authorization of one app and holds the
refresh token; `oauth_access_tokens` hang off it.

- A code is claimed atomically; a replayed code revokes whatever its first
  exchange bought.
- `POST /oauth/revoke` with a refresh token, **Connected apps › Disconnect**,
  and deleting the app all end the grant: its access tokens stop at once and
  the webhooks it subscribed are deleted.
- A deactivated person's tokens stop working.

Scopes, space-separated in the authorization link (`default` when absent):

| Scope     | What the token may do                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `default` | Everything the person can do outside the session-only routes, as Asana started.                                           |
| `read`    | The same reach, looking only: GET, HEAD and OPTIONS, plus subscribing and unsubscribing webhooks. Anything else is `403`. |

Asking for both is asking for `default`. The read-only check is one line in
`JwtAuthGuard`, after the session-only one, so no handler has to remember it;
a write a read-only app may still make (only the webhook subscriptions today)
is marked `@AllowedForReadScope()`. The consent page shows each scope's words,
and Connected apps marks a read-only connection. The column is an array so
further scopes can be added without touching what existing apps were granted.

## Webhook subscriptions (REST hooks)

`/workspaces/:workspaceId/webhook-subscriptions` lets an **API key or an OAuth
app** subscribe a URL to one project's events when someone turns a trigger on,
and delete it when they turn it off — what Zapier calls REST hooks. A person's
own session gets `INTEGRATION_ONLY`; people use Settings › Webhooks.

- **Handshake first** (Asana's `X-Hook-Secret`): before anything is saved,
  CoreTask POSTs `{}` to the URL with an `X-Hook-Secret` header holding the
  new signing secret. The receiver must answer 2xx with the same header and
  value; anything else — another status, no echo, a redirect, a timeout — is
  `422 WEBHOOK_HANDSHAKE_FAILED` and nothing is created. So a subscription
  cannot aim CoreTask's deliveries at a server that did not ask for them. The
  address is resolved and checked first, as a delivery's is.
- Each subscription watches **one project the caller can see** (404 otherwise).
  It is a `webhook_endpoints` row with `projectId` set and `apiKeyId` or
  `oauthGrantId` naming its owner. An integration lists and deletes only its own.
- Deliveries are the same signed POSTs as an admin's endpoints
  (`X-CoreTask-Signature`), with the secret in the create response only.
- **Fan-out re-checks access.** `WebhookDeliveryService.withinReach` drops an
  owned endpoint whose owner was revoked, whose project is gone (a deleted
  project nulls the column — which for an admin's endpoint means "every
  project", and must never mean that here), or whose owner can no longer open
  the project (`ProjectAccessService.canJoinProject`), or whose app the
  workspace no longer allows (see the app directory below).
- Revoking the API key or ending the grant deletes its subscriptions; deleting
  the app cascades.
- At most 50 per integration; they do not count against the 20 admin
  endpoints a workspace may have. The rule builder's "Send a webhook" list
  offers only the admin's endpoints.

The admin's webhook list in Settings shows subscriptions too, labelled
"Added by <app or key>", so nothing receiving workspace data is invisible to
an admin.

## The app directory and the app policy

Each workspace has an app directory (Integrations › App directory,
`/workspaces/:workspaceId/app-directory`, session-only so an app can never
approve itself) and an `oauthAppPolicy`:

| Policy     | Which OAuth apps act in the workspace                    |
| ---------- | -------------------------------------------------------- |
| `ANY`      | Whatever a member connects. The default, as in Asana.    |
| `APPROVED` | Only the apps in the directory (`workspace_oauth_apps`). |

Every member sees the directory and which of its apps they use. Admins switch
the policy, approve an app by its client id (public: it is in every
authorization link), and take apps out again. They also see the apps members
have connected that are not in the directory, with how many members use
each, so switching to `APPROVED` is not a guess.

The policy is checked where the workspace is, not where the person is:

- `WorkspaceMemberGuard`, after membership, refuses an OAuth token with
  `403 OAUTH_APP_NOT_APPROVED` in a workspace that does not allow its app.
  Every workspace route runs that guard, so one check covers them all.
- `GET /workspaces` leaves those workspaces out for the app.
- Webhook fan-out drops the app's subscriptions there (`withinReach`).
- The consent page names the person's workspaces the app would not reach.

Nobody is disconnected. Approving the app again, or switching back to `ANY`,
brings it back at once, subscriptions included. An app is approved per
workspace, not per person: a member cannot approve an app for themselves.

## Not built

- Per-resource scopes (tasks only, one project): `read` and `default` are the two kinds today.
- A public catalogue of apps across workspaces: a workspace's directory lists only what its admins approved, and apps are still found by being sent their authorize link.

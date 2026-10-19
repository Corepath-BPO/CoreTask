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
5. `grant_type=refresh_token` returns a new access token. Refresh tokens are
   not rotated, as Asana's are not.

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

Scopes: one, `default`, as Asana started — everything the person can do outside
the session-only routes. The column is an array so narrower scopes can be added
without touching what existing apps were granted.

## Webhook subscriptions (REST hooks)

`/workspaces/:workspaceId/webhook-subscriptions` lets an **API key or an OAuth
app** subscribe a URL to one project's events when someone turns a trigger on,
and delete it when they turn it off — what Zapier calls REST hooks. A person's
own session gets `INTEGRATION_ONLY`; people use Settings › Webhooks.

- Each subscription watches **one project the caller can see** (404 otherwise).
  It is a `webhook_endpoints` row with `projectId` set and `apiKeyId` or
  `oauthGrantId` naming its owner. An integration lists and deletes only its own.
- Deliveries are the same signed POSTs as an admin's endpoints
  (`X-CoreTask-Signature`), with the secret in the create response only.
- **Fan-out re-checks access.** `WebhookDeliveryService.withinReach` drops an
  owned endpoint whose owner was revoked, whose project is gone (a deleted
  project nulls the column — which for an admin's endpoint means "every
  project", and must never mean that here), or whose owner can no longer open
  the project (`ProjectAccessService.canJoinProject`).
- Revoking the API key or ending the grant deletes its subscriptions; deleting
  the app cascades.
- At most 50 per integration; they do not count against the 20 admin
  endpoints a workspace may have. The rule builder's "Send a webhook" list
  offers only the admin's endpoints.

The admin's webhook list in Settings shows subscriptions too, labelled
"Added by <app or key>", so nothing receiving workspace data is invisible to
an admin.

## Not built

- Narrower scopes (read-only, per resource).
- Public clients without a secret (PKCE-only, for mobile or desktop apps).
- An app directory: apps are found by being sent their authorize link.
- Admin controls over which apps members may connect.
- A handshake on subscription (Asana's `X-Hook-Secret`): the signing secret
  and the auto-disable after repeated failures cover the receiving side.

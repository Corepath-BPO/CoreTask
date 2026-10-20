/**
 * OAuth 2.0 for connectors: how another tool gets to act for a CoreTask user.
 *
 * The authorization-code flow, as Asana runs it. A developer registers an app
 * (Integrations › OAuth apps) and gets a client id and secret. Their tool sends
 * a person to `OAUTH_AUTHORIZE_PATH` on the web app; the person allows it, and
 * the tool trades the code it gets back for an access token and a refresh
 * token at the API's token endpoint.
 *
 * An access token acts as the person who allowed it — everything they can see,
 * in every workspace they belong to — except the routes marked session-only:
 * people, API keys, workspaces and the session itself stay with a signed-in
 * person, exactly as they do for an API key.
 */

/** Recognisable prefixes, so a leaked token is identifiable in logs and secret scanners. */
export const OAUTH_ACCESS_TOKEN_PREFIX = 'cto_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'ctr_';
export const OAUTH_CLIENT_ID_PREFIX = 'ctc_';
export const OAUTH_CLIENT_SECRET_PREFIX = 'cts_';
/** Random bytes behind each prefix: 32 bytes, 43 base64url characters. */
export const OAUTH_TOKEN_BYTES = 32;
/** Characters of the client secret the list shows after its prefix. Display only. */
export const OAUTH_SECRET_DISPLAY_CHARS = 6;

/** An access token lasts an hour; the refresh token gets another. */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3_600;
/** A code is for the redirect that carries it, and only for a few minutes. */
export const OAUTH_CODE_TTL_SECONDS = 600;

/** The web page a tool sends a person to. Query: client_id, redirect_uri, response_type=code, state, scope, code_challenge, code_challenge_method. */
export const OAUTH_AUTHORIZE_PATH = '/oauth/authorize';

/**
 * What an app may ask for, space-separated in the authorization link.
 *
 * `default` is everything the person can do outside the session-only routes,
 * as Asana started. `read` is the same reach, looking only: an app granted it
 * alone may read and may subscribe to webhooks — listening changes nothing —
 * but every other write is refused with `OAUTH_SCOPE_INSUFFICIENT`. Asking for
 * both is asking for `default`.
 */
export const OAuthScope = { DEFAULT: 'default', READ: 'read' } as const;
export type OAuthScope = (typeof OAuthScope)[keyof typeof OAuthScope];
export const OAUTH_SCOPES = Object.values(OAuthScope);

export const OAUTH_SCOPE_DESCRIPTION: Record<OAuthScope, string> = {
  default:
    'See and change the tasks, projects, comments and fields you can reach, in every workspace you belong to. It cannot manage people, API keys or workspaces.',
  read: 'See the tasks, projects, comments and fields you can reach, in every workspace you belong to, and hear about changes to them. It cannot change anything.',
};

/** Whether a grant's scopes let its tokens change anything. */
export function oauthScopesAllowWrites(scopes: readonly string[]): boolean {
  return scopes.includes(OAuthScope.DEFAULT);
}

/** One scope set per request: `default` covers `read`, so the two together are `default`. */
export function normaliseOAuthScopes(scopes: readonly OAuthScope[]): OAuthScope[] {
  return scopes.includes(OAuthScope.DEFAULT) ? [OAuthScope.DEFAULT] : [...new Set(scopes)];
}

/**
 * What kind of client an app is (RFC 6749 §2.1).
 *
 * A confidential client runs on a server and keeps a secret. A public one is a
 * mobile or desktop app, whose code anyone can read, so it is given no secret
 * at all: it proves itself with PKCE on every authorization instead, and its
 * refresh token is replaced each time it is used, so a stolen one works once.
 * Chosen when the app is registered, and fixed from then on.
 */
export const OAuthClientType = { CONFIDENTIAL: 'confidential', PUBLIC: 'public' } as const;
export type OAuthClientType = (typeof OAuthClientType)[keyof typeof OAuthClientType];
export const OAUTH_CLIENT_TYPES = Object.values(OAuthClientType);

/**
 * Which OAuth apps may act in a workspace. `ANY`: whatever its members
 * connect, as Asana does by default. `APPROVED`: only the apps its admins put
 * in its app directory. Anywhere else an app is refused with
 * `OAUTH_APP_NOT_APPROVED`, hears none of the workspace's webhooks and does
 * not see it listed. The person stays connected, so the app keeps working in
 * the workspaces that allow it.
 */
export const OAuthAppPolicy = { ANY: 'ANY', APPROVED: 'APPROVED' } as const;
export type OAuthAppPolicy = (typeof OAuthAppPolicy)[keyof typeof OAuthAppPolicy];
export const OAUTH_APP_POLICIES = Object.values(OAuthAppPolicy);

/** PKCE: only the hashed form. `plain` would protect nothing a TLS connection does not. */
export const OAUTH_CODE_CHALLENGE_METHOD = 'S256';

export const OAUTH_APP_NAME_MAX_LENGTH = 80;
export const OAUTH_APP_DESCRIPTION_MAX_LENGTH = 500;
export const MAX_OAUTH_APPS_PER_USER = 20;
export const MAX_OAUTH_REDIRECT_URIS = 10;
export const OAUTH_REDIRECT_URI_MAX_LENGTH = 2048;

/**
 * Whether a redirect URI may be registered, or why not.
 *
 * https, or http on the loopback address for a tool being developed on the
 * same machine (RFC 8252). No fragment, because the code arrives in the query
 * and a fragment would be dropped by the browser before the tool saw it. The
 * match at authorization time is exact, so a registered URI is the only place
 * a code can ever be sent.
 *
 * A public client may also register a private-use scheme — reverse-domain,
 * so it holds a dot: `com.example.app:/oauth/callback` (RFC 8252 §7.1) — which
 * is how a mobile app gets the code back from the browser.
 */
export function redirectUriProblem(
  value: string,
  options: { publicClient?: boolean } = {},
): string | null {
  const privateUse = /^([a-z][a-z0-9+-]*(?:\.[a-z0-9+-]+)+):\/{1,3}([^#\s]*)(#.*)?$/i.exec(
    value.trim(),
  );
  if (privateUse && !/^https?$/i.test(privateUse[1] ?? '')) {
    if (!options.publicClient) {
      return 'An app scheme like com.example.app:/ is for mobile and desktop apps. Register this app as one.';
    }
    if (privateUse[3] !== undefined) return 'A redirect URI cannot have a #fragment.';
    return null;
  }

  // No URL global here (this package runs anywhere), so the parts are read
  // with a pattern: scheme, authority, then whatever follows.
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^#]*)(#.*)?$/i.exec(value.trim());
  if (!match) return 'Enter a full URL, starting with https://.';
  const [, scheme = '', authority = '', , fragment] = match;
  if (fragment !== undefined) return 'A redirect URI cannot have a #fragment.';
  if (authority.includes('@')) return 'A redirect URI cannot carry a user name or password.';
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  if (!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)$/.test(host))
    return 'Enter a full URL, starting with https://.';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (scheme.toLowerCase() === 'https') return null;
  if (scheme.toLowerCase() === 'http' && loopback) return null;
  return 'Use https://, or http:// on localhost while developing.';
}

/**
 * Webhook subscriptions an integration makes through the API.
 *
 * Each one watches a single project the caller can see, because a webhook
 * made by a person's tool must never hear about a private project that person
 * cannot open. Workspace-wide endpoints stay in Settings, with admins.
 */
export const MAX_WEBHOOK_SUBSCRIPTIONS_PER_INTEGRATION = 50;

/** Who made a webhook endpoint: a person in Settings, an API key, or an OAuth app. */
export const WebhookEndpointSource = {
  SETTINGS: 'SETTINGS',
  API_KEY: 'API_KEY',
  OAUTH_APP: 'OAUTH_APP',
} as const;
export type WebhookEndpointSource =
  (typeof WebhookEndpointSource)[keyof typeof WebhookEndpointSource];

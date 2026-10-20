import type { OAuthScope, SubscribableWebhookEvent } from '@coretask/contracts';

/** An app a developer registered (Integrations › OAuth apps). */
export interface OAuthApp {
  id: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  redirectUris: string[];
  /** Public; goes in the authorization link. */
  clientId: string;
  /** `cts_` and a few characters, to tell secrets apart. Never the secret. */
  secretHint: string;
  /** People who have it connected now. */
  connections: number;
  createdAt: string;
  updatedAt: string;
}

/** The one response besides a rotation that carries the client secret. */
export interface CreatedOAuthApp {
  app: OAuthApp;
  clientSecret: string;
}

export interface OAuthSecretRotation {
  clientSecret: string;
}

export interface CreateOAuthAppPayload {
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  redirectUris: string[];
}

export type UpdateOAuthAppPayload = Partial<CreateOAuthAppPayload>;

/** An authorization request as the consent page forwards it to the API. */
export interface OAuthAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  responseType?: string;
  /** Space-separated; absent means `default`. */
  scope?: string;
  state?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
}

/** What the consent page shows: who is asking, for what, and where the person goes next. */
export interface OAuthConsent {
  app: {
    name: string;
    description: string | null;
    websiteUrl: string | null;
    /** The developer who registered it. */
    publisher: string;
  };
  scopes: { scope: OAuthScope; description: string }[];
  /** The host the person is sent back to, shown so they know where they are going. */
  redirectHost: string;
}

export interface OAuthDecision extends OAuthAuthorizationRequest {
  approve: boolean;
}

/** Where the browser goes after the person decides: the app's redirect URI, with a code or an error. */
export interface OAuthRedirect {
  redirectTo: string;
}

/** An app a person has connected (Integrations › Connected apps). */
export interface ConnectedApp {
  app: { id: string; name: string; websiteUrl: string | null; publisher: string };
  scopes: OAuthScope[];
  connectedAt: string;
  lastUsedAt: string | null;
  /** Separate authorizations of the same app — two Zapier accounts, say. */
  connections: number;
}

/** The token endpoint's answer (RFC 6749 §5.1), plus who the token acts for. */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  /** On the first exchange only: a refresh keeps the token the app already has. */
  refresh_token?: string;
  scope: string;
  user: { id: string; name: string; email: string };
}

/** A webhook an integration subscribed through the API. */
export interface WebhookSubscription {
  id: string;
  workspaceId: string;
  project: { id: string; name: string };
  name: string;
  url: string;
  events: SubscribableWebhookEvent[];
  enabled: boolean;
  disabledReason: string | null;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export interface CreatedWebhookSubscription {
  subscription: WebhookSubscription;
  /** Signs every delivery; in this response and nowhere afterwards. */
  secret: string;
}

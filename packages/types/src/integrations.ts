import type { ApiKeyRole, IntegrationPrincipal, WorkspaceRole } from '@coretask/contracts';

export interface ApiKeyCreator {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * A workspace API key as the settings page sees it.
 *
 * The secret is absent on purpose: it is returned once, at creation, and only
 * its hash is stored — the same rule invitations follow for their token.
 */
export interface ApiKey {
  id: string;
  workspaceId: string;
  name: string;
  /** e.g. `ctk_AbCdEfGh` — enough to recognise a key, never enough to use it. */
  prefix: string;
  role: ApiKeyRole;
  /** The hidden service account this key acts as; work it creates carries this id. */
  userId: string;
  /** Null when the creating admin's account has since been removed. */
  createdBy: ApiKeyCreator | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** True once `expiresAt` has passed; the API decides, not the client's clock. */
  expired: boolean;
}

/** The one response that carries the raw secret. */
export interface CreatedApiKey {
  key: ApiKey;
  secret: string;
}

export interface CreateApiKeyPayload {
  name: string;
  /** Defaults to MEMBER. */
  role?: ApiKeyRole;
  /** Null or absent means the key does not expire. */
  expiresInDays?: number | null;
}

export interface UpdateApiKeyPayload {
  name?: string;
  role?: ApiKeyRole;
}

/** What `/integration/whoami` answers, so a tool can check its credential and learn its ids. */
export interface IntegrationWhoAmI {
  principal: IntegrationPrincipal;
  user: { id: string; name: string; email: string };
  /** The key's workspace; null for a signed-in person, who may belong to several. */
  workspace: { id: string; name: string; slug: string } | null;
  apiKey: { id: string; name: string; role: WorkspaceRole } | null;
}

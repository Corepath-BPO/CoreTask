import { Injectable } from '@nestjs/common';

import { getEnv } from './env';
import { type Env, type storageEnv } from './env.schema';

/**
 * Typed, structured view over the validated environment.
 *
 * Everything downstream injects this instead of touching `process.env`, so the
 * shape of configuration is discoverable and a rename is a compile error.
 */
@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor() {
    this.env = getEnv();
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get http() {
    return {
      port: this.env.API_PORT,
      apiUrl: this.env.API_URL,
    } as const;
  }

  /**
   * CORS allowlist. `WEB_URL` may hold a comma-separated list so that preview
   * deployments can be permitted without a code change.
   */
  get corsOrigins(): string[] {
    return this.env.WEB_URL.split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter((origin) => origin.length > 0);
  }

  /**
   * The web app's address for every link CoreTask builds — e-mails, feeds,
   * Slack, redirects: the first of `WEB_URL`'s origins, with no trailing
   * slash. The rest are only let in by CORS. There is deliberately no getter
   * for `WEB_URL` itself, since a link joined to the whole list leads nowhere.
   */
  get webOrigin(): string {
    // Never empty: the schema refuses a WEB_URL that names no origin.
    return this.corsOrigins[0] ?? '';
  }

  get database() {
    return { url: this.env.DATABASE_URL } as const;
  }

  get redis() {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      password: this.env.REDIS_PASSWORD,
      db: this.env.REDIS_DB,
    } as const;
  }

  get queues() {
    return { prefix: this.env.QUEUE_PREFIX } as const;
  }

  get jwt() {
    return {
      accessSecret: this.env.JWT_ACCESS_SECRET,
      refreshSecret: this.env.JWT_REFRESH_SECRET,
      accessExpiresIn: this.env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: this.env.JWT_REFRESH_EXPIRES_IN,
    } as const;
  }

  get cookie() {
    return {
      domain: this.env.COOKIE_DOMAIN,
      sameSite: this.env.COOKIE_SAME_SITE,
      // Browsers reject `Secure` cookies over plain HTTP, so it can only be
      // switched on where TLS is guaranteed.
      secure: this.isProduction || this.env.COOKIE_SAME_SITE === 'none',
    } as const;
  }

  get rateLimit() {
    return {
      ttlSeconds: this.env.RATE_LIMIT_TTL,
      limit: this.env.RATE_LIMIT_MAX,
      authLimit: this.env.AUTH_RATE_LIMIT_MAX,
    } as const;
  }

  get storage(): StorageConfig {
    return storageConfig(this.env);
  }

  /**
   * Microsoft Graph mail settings.
   *
   * `enabled` needs only one check because the schema refuses a partial
   * configuration outright, so any one value present means all of them are.
   */
  get webhooks() {
    return {
      timeoutMs: this.env.WEBHOOK_TIMEOUT_MS,
      maxAttempts: this.env.WEBHOOK_MAX_ATTEMPTS,
      retryBaseDelayMs: this.env.WEBHOOK_RETRY_BASE_DELAY_MS,
      autoDisableAfter: this.env.WEBHOOK_AUTO_DISABLE_AFTER,
      retentionDays: this.env.WEBHOOK_DELIVERY_RETENTION_DAYS,
      allowPrivateUrls: this.env.WEBHOOK_ALLOW_PRIVATE_URLS,
      /**
       * What the secret cipher derives its key from. Production sets it
       * explicitly (the schema insists); elsewhere the access-token secret
       * stands in so a checkout works with no extra configuration.
       */
      encryptionKeyMaterial:
        this.env.WEBHOOK_SECRET_ENCRYPTION_KEY ?? `${this.env.JWT_ACCESS_SECRET}:webhooks`,
    } as const;
  }

  /**
   * Email to a project. `enabled` checks one value because the schema refuses
   * a domain without a secret and the other way round.
   */
  get inboundEmail() {
    return {
      domain: this.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() ?? null,
      secret: this.env.INBOUND_EMAIL_SECRET ?? null,
      enabled: Boolean(this.env.INBOUND_EMAIL_DOMAIN),
    } as const;
  }

  /** The model behind the AI steps in rules; `enabled` is whether there is one. */
  get ai() {
    return {
      apiKey: this.env.ANTHROPIC_API_KEY ?? null,
      baseUrl: this.env.ANTHROPIC_BASE_URL.replace(/\/+$/, ''),
      model: this.env.AI_MODEL,
      timeoutMs: this.env.AI_TIMEOUT_MS,
      enabled: Boolean(this.env.ANTHROPIC_API_KEY),
    } as const;
  }

  /**
   * The CoreTask Slack app. `enabled` checks one value because the schema
   * refuses a partial set. Installs come back to the web app, which finishes
   * them with the admin's session — that is what ties an install to the
   * person who started it.
   */
  get asana() {
    return {
      accessToken: this.env.ASANA_ACCESS_TOKEN ?? null,
      workspaceGid: this.env.ASANA_WORKSPACE_ID ?? null,
      apiBaseUrl: this.env.ASANA_API_BASE_URL.replace(/\/+$/, ''),
      timeoutMs: this.env.ASANA_TIMEOUT_MS,
      maxRequestsPerMinute: this.env.ASANA_MAX_REQUESTS_PER_MINUTE,
      concurrency: this.env.ASANA_CONCURRENCY,
      liveSyncIntervalMs: this.env.ASANA_LIVE_SYNC_INTERVAL_MS,
      liveDefinitionsIntervalMs: this.env.ASANA_LIVE_DEFINITIONS_INTERVAL_MS,
      fullSyncCron: this.env.ASANA_FULL_SYNC_CRON,
      fullSyncTz: this.env.ASANA_FULL_SYNC_TZ,
      enabled: Boolean(this.env.ASANA_ACCESS_TOKEN && this.env.ASANA_WORKSPACE_ID),
    } as const;
  }

  get slack() {
    return {
      clientId: this.env.SLACK_CLIENT_ID ?? null,
      clientSecret: this.env.SLACK_CLIENT_SECRET ?? null,
      signingSecret: this.env.SLACK_SIGNING_SECRET ?? null,
      apiBaseUrl: this.env.SLACK_API_BASE_URL.replace(/\/+$/, ''),
      authorizeUrl: this.env.SLACK_AUTHORIZE_URL,
      timeoutMs: this.env.SLACK_TIMEOUT_MS,
      redirectUri: `${this.webOrigin}/integrations/slack/callback`,
      enabled: Boolean(this.env.SLACK_CLIENT_ID),
    } as const;
  }

  /** Days a new account may run before its address must be confirmed. */
  get emailVerificationGraceDays(): number {
    return this.env.EMAIL_VERIFICATION_GRACE_DAYS;
  }

  /**
   * "Sign in with Google / Microsoft". Callbacks land on the API, which sets
   * the session cookie and sends the browser on to the web app.
   */
  get sso() {
    const apiBase = `${this.env.API_URL.replace(/\/+$/, '')}/api/v1`;
    const microsoftBase = `${this.env.MICROSOFT_SSO_LOGIN_URL.replace(/\/+$/, '')}/${this.env.MICROSOFT_SSO_TENANT}`;
    return {
      apiBase,
      timeoutMs: this.env.SSO_TIMEOUT_MS,
      google: {
        enabled: Boolean(this.env.GOOGLE_SSO_CLIENT_ID),
        clientId: this.env.GOOGLE_SSO_CLIENT_ID ?? null,
        clientSecret: this.env.GOOGLE_SSO_CLIENT_SECRET ?? null,
        issuer: this.env.GOOGLE_SSO_ISSUER.replace(/\/+$/, ''),
        authorizeUrl: this.env.GOOGLE_SSO_AUTHORIZE_URL,
        tokenUrl: this.env.GOOGLE_SSO_TOKEN_URL,
        redirectUri: `${apiBase}/auth/sso/google/callback`,
      },
      microsoft: {
        enabled: Boolean(this.env.MICROSOFT_SSO_CLIENT_ID),
        clientId: this.env.MICROSOFT_SSO_CLIENT_ID ?? null,
        clientSecret: this.env.MICROSOFT_SSO_CLIENT_SECRET ?? null,
        loginUrl: this.env.MICROSOFT_SSO_LOGIN_URL.replace(/\/+$/, ''),
        tenant: this.env.MICROSOFT_SSO_TENANT,
        authorizeUrl: `${microsoftBase}/oauth2/v2.0/authorize`,
        tokenUrl: `${microsoftBase}/oauth2/v2.0/token`,
        redirectUri: `${apiBase}/auth/sso/microsoft/callback`,
      },
    } as const;
  }

  get microsoftGraph() {
    return {
      tenantId: this.env.MICROSOFT_GRAPH_TENANT_ID,
      clientId: this.env.MICROSOFT_GRAPH_CLIENT_ID,
      clientSecret: this.env.MICROSOFT_GRAPH_CLIENT_SECRET,
      baseUrl: normalizeGraphBaseUrl(this.env.MICROSOFT_GRAPH_BASE_URL),
      /** The mailbox mail is sent as. Must exist in the tenant. */
      fromAddress: this.env.MAIL_FROM_ADDRESS,
      /** The display name shown beside it in an inbox. */
      fromName: this.env.MAIL_FROM_NAME,
      /** Where replies go when a message names no reply address of its own. */
      replyTo: this.env.MAIL_REPLY_TO,
      timeoutMs: this.env.MAIL_CONNECTION_TIMEOUT_MS,
      enabled: Boolean(this.env.MICROSOFT_GRAPH_TENANT_ID),
    } as const;
  }
}

/**
 * Accepts `MICROSOFT_GRAPH_BASE_URL` with or without the API version.
 *
 * Both `https://graph.microsoft.com` and `https://graph.microsoft.com/v1.0` are
 * things people reasonably put in a `.env`, and the difference between them is a
 * 404 at the first send rather than anything visible at boot. Normalising here
 * means the transport can concatenate paths without thinking about it.
 */
export function normalizeGraphBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return /\/(v\d+(\.\d+)?|beta)$/i.test(trimmed) ? trimmed : `${trimmed}/v1.0`;
}

type StorageEnv = Pick<Env, keyof typeof storageEnv>;

export interface StorageConfig {
  readonly endpoint: string;
  /** Falls back to the internal endpoint when they are the same host. */
  readonly publicEndpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly forcePathStyle: boolean;
  readonly maxFileSizeBytes: number;
}

/**
 * The storage settings alone, for {@link AppConfigService.storage} and for the
 * `storage:check` script, which parses only `STORAGE_*`.
 */
export function storageConfig(env: StorageEnv): StorageConfig {
  return {
    endpoint: env.STORAGE_ENDPOINT,
    publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT || env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    maxFileSizeBytes: env.STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024,
  };
}

import { Injectable } from '@nestjs/common';

import { getEnv } from './env';
import { type Env } from './env.schema';

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
      webUrl: this.env.WEB_URL,
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

  get storage() {
    return {
      endpoint: this.env.STORAGE_ENDPOINT,
      /** Falls back to the internal endpoint when they are the same host. */
      publicEndpoint: this.env.STORAGE_PUBLIC_ENDPOINT || this.env.STORAGE_ENDPOINT,
      region: this.env.STORAGE_REGION,
      bucket: this.env.STORAGE_BUCKET,
      accessKey: this.env.STORAGE_ACCESS_KEY,
      secretKey: this.env.STORAGE_SECRET_KEY,
      forcePathStyle: this.env.STORAGE_FORCE_PATH_STYLE,
      maxFileSizeBytes: this.env.STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024,
    } as const;
  }

  get smtp() {
    return {
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      user: this.env.SMTP_USER,
      password: this.env.SMTP_PASSWORD,
      secure: this.env.SMTP_SECURE,
      from: this.env.SMTP_FROM,
      /** Without a host the log transport is used — see EmailService. */
      enabled: Boolean(this.env.SMTP_HOST),
    } as const;
  }

  /**
   * Microsoft Graph mail settings.
   *
   * `enabled` needs only one check because the schema refuses a partial
   * configuration outright, so any one value present means all of them are.
   */
  get microsoftGraph() {
    return {
      tenantId: this.env.MICROSOFT_GRAPH_TENANT_ID,
      clientId: this.env.MICROSOFT_GRAPH_CLIENT_ID,
      clientSecret: this.env.MICROSOFT_GRAPH_CLIENT_SECRET,
      baseUrl: normalizeGraphBaseUrl(this.env.MICROSOFT_GRAPH_BASE_URL),
      /** The mailbox mail is sent as. Must exist in the tenant. */
      fromAddress: this.env.MAIL_FROM_ADDRESS,
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

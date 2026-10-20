import { z } from 'zod';

/**
 * An unset variable and an empty one mean the same thing in a `.env` file
 * (`COOKIE_DOMAIN=` is empty, not the string `""`), so blanks collapse to
 * `undefined` before validation runs.
 */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

/**
 * `z.coerce.boolean()` follows JS truthiness, which makes the string `"false"`
 * evaluate to `true`. Env flags need explicit parsing.
 */
const booleanFlag = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value ?? defaultValue;
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }, z.boolean());

const port = z.coerce.number().int().min(1).max(65_535);

/** Rejects the placeholder secrets shipped in `.env.example` when NODE_ENV=production. */
const secret = z
  .string()
  .min(
    32,
    "Must be at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    WEB_URL: z.string().min(1).default('http://localhost:5173'),
    API_URL: z.string().min(1).default('http://localhost:3000'),
    API_PORT: port.default(3000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),

    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: port.default(6379),
    REDIS_PASSWORD: optionalString,
    REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
    // BullMQ's own default. The API and the worker must share it: the API
    // queues jobs under it and the worker takes them from there.
    QUEUE_PREFIX: z
      .string()
      .regex(/^[\w-]+$/, 'letters, digits, "_" and "-" only')
      .default('bull'),

    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),

    COOKIE_DOMAIN: optionalString,
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    /**
     * Days a new account may be used before its address has to be confirmed.
     * Past that, the API answers EMAIL_NOT_VERIFIED to everything but the
     * routes that confirm, change or resend — and the app shows a gate.
     * Inviting people and connecting integrations need a confirmed address
     * from the start, whatever this says.
     */
    EMAIL_VERIFICATION_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(7),

    /*
     * "Sign in with Google" and "Sign in with Microsoft": OpenID Connect apps
     * whose redirect URI is `${API_URL}/api/v1/auth/sso/<google|microsoft>/callback`.
     * Each pair is all or nothing; without one the button is not shown.
     * MICROSOFT_SSO_TENANT is `common` (work and personal accounts),
     * `organizations`, `consumers`, or one tenant's id. Secrets: .env only.
     * The base URLs exist so tests can stand in for the providers.
     */
    GOOGLE_SSO_CLIENT_ID: optionalString,
    GOOGLE_SSO_CLIENT_SECRET: optionalString,
    GOOGLE_SSO_ISSUER: z.string().url().default('https://accounts.google.com'),
    GOOGLE_SSO_AUTHORIZE_URL: z
      .string()
      .url()
      .default('https://accounts.google.com/o/oauth2/v2/auth'),
    GOOGLE_SSO_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
    MICROSOFT_SSO_CLIENT_ID: optionalString,
    MICROSOFT_SSO_CLIENT_SECRET: optionalString,
    MICROSOFT_SSO_TENANT: z.string().min(1).default('common'),
    MICROSOFT_SSO_LOGIN_URL: z.string().url().default('https://login.microsoftonline.com'),
    SSO_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),

    RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    STORAGE_ENDPOINT: z.string().min(1).default('http://localhost:9000'),
    /**
     * Where a *browser* reaches storage, when that differs from where the API
     * does. In Docker the API talks to `coretask-storage:9000`, a hostname that
     * exists only on the compose network — presigning with it produces URLs no
     * client can resolve. The signature covers the Host header, so this cannot
     * be patched in afterwards; the URL has to be signed for the host the
     * browser will actually connect to. Empty means the two are the same, which
     * is the normal case against real S3.
     */
    STORAGE_PUBLIC_ENDPOINT: z.string().default(''),
    STORAGE_REGION: z.string().min(1).default('us-east-1'),
    STORAGE_BUCKET: z.string().min(1).default('coretask'),
    STORAGE_ACCESS_KEY: z.string().min(1).default('coretask_minio'),
    STORAGE_SECRET_KEY: z.string().min(1).default('coretask_minio_dev_password'),
    STORAGE_FORCE_PATH_STYLE: booleanFlag(true),
    STORAGE_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().max(1024).default(25),

    /*
     * Microsoft Graph, the e-mail transport, used when all four values are set;
     * without them e-mail is written to the log instead.
     * Client-credentials flow against an app registration holding the
     * application permission `Mail.Send`; mail is sent as MAIL_FROM_ADDRESS,
     * which must be a real mailbox in the tenant.
     */
    MICROSOFT_GRAPH_TENANT_ID: optionalString,
    MICROSOFT_GRAPH_CLIENT_ID: optionalString,
    MICROSOFT_GRAPH_CLIENT_SECRET: optionalString,
    MICROSOFT_GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com/v1.0'),
    MAIL_FROM_ADDRESS: optionalString,
    /*
     * The display name beside the address. Defaulted rather than required, so
     * it stays out of the all-or-nothing group below: a missing name is a
     * cosmetic problem, not a broken transport.
     */
    MAIL_FROM_NAME: z.string().min(1).default('CoreTask'),
    MAIL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(15_000),

    /*
     * Email to a project. Mail for `<token>@INBOUND_EMAIL_DOMAIN` is accepted by
     * a mail provider (Postmark, SendGrid, Mailgun…) and posted to
     * `/api/v1/inbound/email` with INBOUND_EMAIL_SECRET as the password of HTTP
     * Basic auth, or in the `X-Inbound-Secret` header. Both or neither.
     */
    INBOUND_EMAIL_DOMAIN: optionalString,
    INBOUND_EMAIL_SECRET: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().min(16, 'At least 16 characters.').optional(),
    ),

    /*
     * The model behind the AI steps in rules. Without a key the steps are
     * greyed out with a reason — there is no stand-in model. The key is a
     * secret: .env only, never a compose file or an image.
     */
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
    AI_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),

    /*
     * The CoreTask Slack app (docs/integrations/slack.md): a workspace admin
     * installs it, then people create tasks from Slack and act on the ones
     * CoreTask posts. The three come from the app's Basic Information page,
     * all or none; without them Integrations › Slack says what is missing.
     * Secrets: .env only. The two addresses exist so tests can stand in for
     * Slack, and nothing else should change them.
     */
    SLACK_CLIENT_ID: optionalString,
    SLACK_CLIENT_SECRET: optionalString,
    SLACK_SIGNING_SECRET: optionalString,
    SLACK_API_BASE_URL: z.string().url().default('https://slack.com/api'),
    SLACK_AUTHORIZE_URL: z.string().url().default('https://slack.com/oauth/v2/authorize'),
    SLACK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),

    /*
     * Outbound webhooks. Delivery retries follow BullMQ's exponential backoff
     * from the base delay: 30 s, 1 m, 2 m, 4 m, 8 m by default.
     */
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(30_000),
    /** Consecutive final failures before an endpoint switches itself off. */
    WEBHOOK_AUTO_DISABLE_AFTER: z.coerce.number().int().min(1).max(1_000).default(20),
    WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /**
     * Allow endpoints on localhost and private networks. Off by default so a
     * workspace admin cannot point CoreTask at internal services; on for a
     * developer whose n8n runs on the same laptop.
     */
    WEBHOOK_ALLOW_PRIVATE_URLS: booleanFlag(false),
    /**
     * Key material for encrypting signing secrets at rest. Outside production
     * it is derived from JWT_ACCESS_SECRET so development needs no extra
     * setting; production must set it, and losing it means rotating every
     * endpoint's secret.
     */
    WEBHOOK_SECRET_ENCRYPTION_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    /*
     * All or nothing, in every environment. A half-configured Graph would fall
     * back to the log transport and look like it was working — nobody notices
     * invitations are not being delivered until someone complains they never
     * got one. Failing at boot is the only honest outcome.
     */
    const graphKeys = [
      'MICROSOFT_GRAPH_TENANT_ID',
      'MICROSOFT_GRAPH_CLIENT_ID',
      'MICROSOFT_GRAPH_CLIENT_SECRET',
      'MAIL_FROM_ADDRESS',
    ] as const;
    const provided = graphKeys.filter((key) => env[key]);

    if (provided.length > 0 && provided.length < graphKeys.length) {
      for (const key of graphKeys.filter((candidate) => !env[candidate])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when any other Microsoft Graph mail setting is present.',
        });
      }
    }

    // A client id without its secret shows a button that fails at the callback.
    for (const [id, secret] of [
      ['GOOGLE_SSO_CLIENT_ID', 'GOOGLE_SSO_CLIENT_SECRET'],
      ['MICROSOFT_SSO_CLIENT_ID', 'MICROSOFT_SSO_CLIENT_SECRET'],
    ] as const) {
      if (Boolean(env[id]) !== Boolean(env[secret])) {
        ctx.addIssue({
          code: 'custom',
          path: [env[id] ? secret : id],
          message: 'Sign-in apps need both a client id and a client secret.',
        });
      }
    }

    // Same reasoning as Graph: half a Slack app installs, then fails every
    // request it signs, which is worse than saying so at boot.
    const slackKeys = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'] as const;
    const slackProvided = slackKeys.filter((key) => env[key]);
    if (slackProvided.length > 0 && slackProvided.length < slackKeys.length) {
      for (const key of slackKeys.filter((candidate) => !env[candidate])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when any other Slack app setting is present.',
        });
      }
    }

    if (Boolean(env.INBOUND_EMAIL_DOMAIN) !== Boolean(env.INBOUND_EMAIL_SECRET)) {
      const missing = env.INBOUND_EMAIL_DOMAIN ? 'INBOUND_EMAIL_SECRET' : 'INBOUND_EMAIL_DOMAIN';
      ctx.addIssue({
        code: 'custom',
        path: [missing],
        message: 'Inbound email needs both a domain and a secret.',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ in production.',
      });
    }

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].startsWith('dev_only_')) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'The development placeholder secret cannot be used in production.',
        });
      }
    }

    if (env.COOKIE_SAME_SITE === 'none' && !env.WEB_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAME_SITE'],
        message: 'SameSite=None requires the client to be served over HTTPS.',
      });
    }

    if (!env.WEBHOOK_SECRET_ENCRYPTION_KEY || env.WEBHOOK_SECRET_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_SECRET_ENCRYPTION_KEY'],
        message:
          'Required in production, at least 32 characters. Webhook signing secrets are encrypted with it.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

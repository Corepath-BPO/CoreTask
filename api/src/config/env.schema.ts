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

    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),

    COOKIE_DOMAIN: optionalString,
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    STORAGE_ENDPOINT: z.string().min(1).default('http://localhost:9000'),
    /**
     * Where a *browser* reaches storage, when that differs from where the API
     * does. In Docker the API talks to `coretask-minio:9000`, a hostname that
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

    // An empty SMTP_HOST selects the development transport, which writes the
    // rendered message to the log instead of opening a connection.
    SMTP_HOST: optionalString,
    SMTP_PORT: port.default(1025),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_SECURE: booleanFlag(false),
    SMTP_FROM: z.string().min(1).default('CoreTask <no-reply@coretask.local>'),

    /*
     * Microsoft Graph, used in preference to SMTP when all four values are set.
     * Client-credentials flow against an app registration holding the
     * application permission `Mail.Send`; mail is sent as MAIL_FROM_ADDRESS,
     * which must be a real mailbox in the tenant.
     */
    MICROSOFT_GRAPH_TENANT_ID: optionalString,
    MICROSOFT_GRAPH_CLIENT_ID: optionalString,
    MICROSOFT_GRAPH_CLIENT_SECRET: optionalString,
    MICROSOFT_GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com/v1.0'),
    MAIL_FROM_ADDRESS: optionalString,
    MAIL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(15_000),
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
  });

export type Env = z.infer<typeof envSchema>;

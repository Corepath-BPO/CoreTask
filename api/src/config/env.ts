import { envSchema, type Env } from './env.schema';

let cached: Env | null = null;

/** Thrown before Nest bootstraps so a misconfigured deploy fails immediately. */
export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      [
        'Environment validation failed. The API cannot start.',
        ...issues.map((issue) => `  • ${issue}`),
        '',
        'Copy .env.example to .env and fill in the missing values.',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.join('.') || '(root)';
        return `${path}: ${issue.message}`;
      }),
    );
  }

  return result.data;
}

/** Parsed once per process; every consumer reads the same frozen result. */
export function getEnv(): Env {
  cached ??= Object.freeze(parseEnv());
  return cached;
}

/** Test-only: forces the next `getEnv()` to re-read `process.env`. */
export function resetEnvCache(): void {
  cached = null;
}

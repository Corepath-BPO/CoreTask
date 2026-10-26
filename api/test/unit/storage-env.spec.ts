import { storageConfig } from '../../src/config/app-config.service';
import { EnvValidationError, parseEnv } from '../../src/config/env';

/**
 * Production storage settings that would boot fine and fail later: the dev
 * credentials (a bucket anyone who has read the repo can open), or an http
 * storage address under an https app (every upload blocked as mixed content).
 */
describe('storage settings', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://coretask:x@db:5432/coretask',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    WEBHOOK_SECRET_ENCRYPTION_KEY: 'c'.repeat(40),
    WEB_URL: 'https://app.coretask.org',
    STORAGE_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    STORAGE_REGION: 'auto',
    STORAGE_BUCKET: 'coretask-prod',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
  };

  const issues = (env: Record<string, string>): string[] => {
    try {
      parseEnv(env);
      return [];
    } catch (error) {
      if (error instanceof EnvValidationError) return error.issues;
      throw error;
    }
  };

  it('accepts an R2 bucket, the browser using the same address as the server', () => {
    expect(issues(production)).toEqual([]);
    expect(storageConfig(parseEnv(production))).toMatchObject({
      endpoint: production.STORAGE_ENDPOINT,
      publicEndpoint: production.STORAGE_ENDPOINT,
      region: 'auto',
      bucket: 'coretask-prod',
      forcePathStyle: true,
    });
  });

  it('refuses the development credentials in production', () => {
    expect(
      issues({
        ...production,
        STORAGE_ACCESS_KEY: 'coretask_minio',
        STORAGE_SECRET_KEY: 'coretask_minio_dev_password',
      }),
    ).toEqual([
      expect.stringMatching(/^STORAGE_ACCESS_KEY: The development storage credential/),
      expect.stringMatching(/^STORAGE_SECRET_KEY: The development storage credential/),
    ]);
  });

  it('refuses them when they are left unset, since unset means the defaults', () => {
    const { STORAGE_ACCESS_KEY: _key, STORAGE_SECRET_KEY: _secret, ...unset } = production;

    expect(issues(unset)).toHaveLength(2);
  });

  it('refuses an http storage address under an https app', () => {
    expect(issues({ ...production, STORAGE_ENDPOINT: 'http://storage.internal:9000' })).toEqual([
      expect.stringMatching(/^STORAGE_ENDPOINT: Must be https:\/\//),
    ]);
  });

  it('judges the browser-facing address when there is a separate one', () => {
    expect(
      issues({
        ...production,
        STORAGE_ENDPOINT: 'http://coretask-storage:9000',
        STORAGE_PUBLIC_ENDPOINT: 'https://files.coretask.org',
      }),
    ).toEqual([]);
    expect(
      issues({
        ...production,
        STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
      }),
    ).toEqual([expect.stringMatching(/^STORAGE_PUBLIC_ENDPOINT: Must be https:\/\//)]);
  });

  it('leaves development alone: RustFS on http with the compose credentials', () => {
    expect(
      issues({
        DATABASE_URL: production.DATABASE_URL,
        JWT_ACCESS_SECRET: production.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: production.JWT_REFRESH_SECRET,
      }),
    ).toEqual([]);
  });
});

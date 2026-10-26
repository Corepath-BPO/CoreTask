import { z } from 'zod';

/**
 * Client environment, validated at module load.
 *
 * Vite inlines `VITE_*` at build time, so a missing variable is a *build*
 * mistake — failing loudly here beats shipping a bundle that requests
 * `undefined/auth/login` at runtime.
 *
 * Anything referenced here is public. Never put a secret behind a VITE_ prefix.
 */
const envSchema = z.object({
  VITE_API_URL: z
    .string()
    .min(1, 'VITE_API_URL is required.')
    .default('http://localhost:3000/api/v1'),
  VITE_WS_URL: z.string().min(1, 'VITE_WS_URL is required.').default('http://localhost:3000'),
  VITE_APP_NAME: z.string().min(1).default('CoreTask'),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid client environment:\n${issues}`);
}

export const env = Object.freeze({
  apiUrl: parsed.data.VITE_API_URL.replace(/\/$/, ''),
  wsUrl: parsed.data.VITE_WS_URL.replace(/\/$/, ''),
  appName: parsed.data.VITE_APP_NAME,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
});

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
  VITE_API_ORIGINS_BY_HOST: z.string().default(''),
  VITE_APP_NAME: z.string().min(1).default('CoreTask'),
  VITE_SUPPORT_EMAIL: z.email().default('support@coretask.org'),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid client environment:\n${issues}`);
}

/**
 * The API origin for the host this page is served on, when it is not the
 * built-in one: `staging.coretask.org=https://staging-api.coretask.org`,
 * comma-separated. The dev server answers on localhost and, through the
 * staging tunnel, on staging.coretask.org at once, and each page has to call
 * the API on its own side of the tunnel.
 */
export function apiOriginFor(host: string, byHost: string): string | null {
  for (const entry of byHost.split(',')) {
    const [name, origin] = entry.split('=').map((part) => part.trim());
    if (name && origin && name === host) return origin;
  }
  return null;
}

/** `url` with its scheme and host swapped for `origin`'s, path kept. */
export function withOrigin(url: string, origin: string | null): string {
  if (!origin) return url;
  const target = new URL(origin);
  const moved = new URL(url);
  moved.protocol = target.protocol;
  // Hostname and port apart: setting `host` without a port keeps the old one.
  moved.hostname = target.hostname;
  moved.port = target.port;
  return moved.toString();
}

const pageHost = typeof window === 'undefined' ? '' : window.location.host;
const apiOrigin = apiOriginFor(pageHost, parsed.data.VITE_API_ORIGINS_BY_HOST);

export const env = Object.freeze({
  apiUrl: withOrigin(parsed.data.VITE_API_URL, apiOrigin).replace(/\/$/, ''),
  wsUrl: withOrigin(parsed.data.VITE_WS_URL, apiOrigin).replace(/\/$/, ''),
  appName: parsed.data.VITE_APP_NAME,
  supportEmail: parsed.data.VITE_SUPPORT_EMAIL,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
});

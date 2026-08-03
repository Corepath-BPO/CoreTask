/**
 * Loads `.env` files into `process.env`.
 *
 * MUST be imported before anything that reads configuration — that is why it is
 * the first import in `main.ts`, `worker.ts` and the Jest setup files.
 *
 * Inside Docker no `.env` file exists; Compose injects the variables directly
 * and this becomes a no-op.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

// Package-local overrides win over the shared monorepo root file.
const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')].filter(
  (path) => existsSync(path),
);

if (candidates.length > 0) {
  config({ path: candidates, quiet: true });
}

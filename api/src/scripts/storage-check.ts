/**
 * Checks a bucket end to end through the API's own StorageService: the things
 * Cloudflare R2 — or any S3-compatible server — has to get right for uploads,
 * downloads and deletion to work. Run it once for every new bucket:
 *
 *   pnpm --filter @coretask/api storage:check [env file]    the repo's .env by default
 *   node dist/scripts/storage-check.js                      in the API image, env already set
 *
 * Only `STORAGE_*` and `WEB_URL` are read, so the env file needs nothing else.
 * Everything it writes is under `storage-check/<run>/` and is deleted again,
 * pass or fail. Keys are never printed.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { storageConfig, type AppConfigService } from '../config/app-config.service';
import { storageEnv } from '../config/env.schema';
import { StorageService } from '../integrations/storage/storage.service';

/** A 1×1 transparent PNG: a real image, for the paths that only take images. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const TEXT = Buffer.from('CoreTask storage check\n');

interface Step {
  name: string;
  run: () => Promise<string | void>;
}

async function main(): Promise<boolean> {
  const envFile = loadEnvFile(process.argv[2]);
  const config = storageConfig(z.object(storageEnv).parse(process.env));
  const origin = process.env.WEB_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
  const storage = new StorageService({ storage: config } as AppConfigService);

  const prefix = `storage-check/${randomUUID()}/`;
  const textKey = `${prefix}server.txt`;
  const pictureKey = `${prefix}upload.png`;
  const refusedKey = `${prefix}refused.png`;

  print(`Env file  ${envFile ?? '(none — the process environment only)'}`);
  print(`Endpoint  ${config.endpoint}`);
  if (config.publicEndpoint !== config.endpoint) print(`Browser   ${config.publicEndpoint}`);
  print(`Bucket    ${config.bucket}  (region ${config.region})`);
  print(`Origin    ${origin}  (for the CORS preflight)\n`);

  const steps: Step[] = [
    {
      name: 'The server writes an object',
      run: () => storage.putObject(textKey, TEXT, 'text/plain'),
    },
    {
      name: 'HEAD reads back its size and type',
      run: async () => {
        const head = await storage.headObject(textKey);
        ensure(head?.sizeBytes === TEXT.length, `size ${head?.sizeBytes}, wrote ${TEXT.length}`);
        ensure(head.mimeType === 'text/plain', `type ${head.mimeType}`);
        return `${head.sizeBytes} bytes, ${head.mimeType}`;
      },
    },
    {
      name: 'The bucket allows the app origin to PUT (CORS preflight)',
      run: async () => {
        const upload = await storage.presignUpload(pictureKey, 'image/png');
        const response = await fetch(upload.url, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'content-type',
          },
        });
        const allowed = response.headers.get('access-control-allow-origin');
        ensure(
          response.ok && (allowed === origin || allowed === '*'),
          `status ${response.status}, Access-Control-Allow-Origin ${allowed ?? '(none)'}` +
            ' — set the bucket CORS policy (docs/architecture/docker.md)',
        );
        return `Access-Control-Allow-Origin ${allowed}`;
      },
    },
    {
      name: 'A presigned PUT with the signed Content-Type is stored',
      run: async () => {
        const upload = await storage.presignUpload(pictureKey, 'image/png');
        const response = await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: PNG,
        });
        ensure(response.ok, `status ${response.status}: ${await response.text()}`);
        const head = await storage.headObject(pictureKey);
        ensure(head?.mimeType === 'image/png', `stored as ${head?.mimeType ?? 'nothing'}`);
      },
    },
    {
      name: 'A presigned PUT with a different Content-Type is refused',
      run: async () => {
        const upload = await storage.presignUpload(refusedKey, 'image/png');
        const response = await fetch(upload.url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/html' },
          body: '<script>alert(1)</script>',
        });
        ensure(response.status === 403, `status ${response.status}, expected 403`);
        ensure((await storage.headObject(refusedKey)) === null, 'the object was stored anyway');
        return 'status 403';
      },
    },
    {
      name: 'A presigned download is served as an attachment',
      run: async () => {
        const download = await storage.presignDownload(pictureKey, 'check.png');
        const response = await fetch(download.url);
        ensure(response.ok, `status ${response.status}`);
        const disposition = response.headers.get('content-disposition') ?? '';
        ensure(
          disposition.startsWith('attachment'),
          `Content-Disposition "${disposition}": the override was ignored, so an SVG would render`,
        );
        ensure(PNG.equals(Buffer.from(await response.arrayBuffer())), 'the bytes differ');
        return `Content-Disposition ${disposition}`;
      },
    },
    {
      name: 'A presigned view renders inline as the given type',
      run: async () => {
        const view = await storage.presignView(pictureKey, 'image/png');
        const response = await fetch(view.url);
        ensure(response.ok, `status ${response.status}`);
        const disposition = response.headers.get('content-disposition') ?? '';
        const type = response.headers.get('content-type') ?? '';
        ensure(disposition.startsWith('inline'), `Content-Disposition "${disposition}"`);
        ensure(type.startsWith('image/png'), `Content-Type "${type}"`);
        return `${disposition}, ${type}`;
      },
    },
    {
      name: 'Listing a prefix finds what was written',
      run: async () => {
        const keys = await storage.listObjectKeys(prefix);
        ensure(
          keys.includes(textKey) && keys.includes(pictureKey),
          `found ${keys.length}: ${keys.join(', ')}`,
        );
        return `${keys.length} keys`;
      },
    },
    {
      name: 'Batch delete removes them',
      run: async () => {
        const { failed } = await storage.deleteObjects([textKey, pictureKey, refusedKey]);
        ensure(failed === 0, `${failed} could not be deleted`);
        const left = await storage.listObjectKeys(prefix);
        ensure(left.length === 0, `${left.length} still there`);
      },
    },
    {
      name: 'Deleting a key that is not there succeeds',
      run: () => storage.deleteObject(`${prefix}never-written.txt`),
    },
  ];

  let failures = 0;
  try {
    for (const step of steps) {
      try {
        const detail = await step.run();
        print(`  ✓ ${step.name}${detail ? ` — ${detail}` : ''}`);
      } catch (error) {
        failures += 1;
        print(`  ✗ ${step.name} — ${explain(error)}`);
      }
    }
  } finally {
    // Whatever a failed step left behind; deleting what is gone is a success.
    await storage.deleteObjects([textKey, pictureKey, refusedKey]).catch(() => undefined);
    storage.onModuleDestroy();
  }

  print(
    failures === 0
      ? '\nThe bucket works with CoreTask.'
      : `\n${failures} of ${steps.length} checks failed.`,
  );
  return failures === 0;
}

/**
 * Loads `argument` (relative to where the command was typed), or the repo's
 * `.env` when there is one. Variables already in the environment win, as
 * they do for Node's own `--env-file`.
 */
function loadEnvFile(argument: string | undefined): string | null {
  const path = argument
    ? resolve(process.env.INIT_CWD ?? process.cwd(), argument)
    : resolve(__dirname, '..', '..', '..', '.env');

  if (!existsSync(path)) {
    if (argument) throw new Error(`No env file at ${path}`);
    return null;
  }
  process.loadEnvFile(path);
  return path;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function explain(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status ? `${error.name} (HTTP ${status}): ${error.message}` : error.message;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

main().then(
  (passed) => {
    process.exitCode = passed ? 0 : 1;
  },
  (error: unknown) => {
    console.error(explain(error));
    process.exitCode = 1;
  },
);

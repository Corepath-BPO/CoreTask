/*
 * Serves the static export in out/ the way nginx will — exact files, then
 * <path>/index.html, then 404.html — so the built site can be checked before
 * it ships. `pnpm build` first.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const outDir = path.resolve(import.meta.dirname, '..', 'out');
const port = Number(process.env.PORT ?? 3201);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function resolveFile(urlPath: string) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const candidate = path.join(outDir, clean);
  if (!candidate.startsWith(outDir)) return null;
  for (const file of [candidate, path.join(candidate, 'index.html')]) {
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}

createServer(async (req, res) => {
  const file = await resolveFile(new URL(req.url ?? '/', 'http://localhost').pathname);
  const target = file ?? path.join(outDir, '404.html');
  res.writeHead(file ? 200 : 404, {
    'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
  });
  createReadStream(target).pipe(res);
}).listen(port, () => {
  console.warn(`Serving out/ at http://localhost:${port}`);
});

/*
 * Renders the site's generated images with Remotion:
 *
 *   public/og.png              the share card link previews show
 *   public/media/<clip>.webp   each product clip's last frame, shown before the
 *                              live player loads and when motion is reduced
 *
 * The outputs are committed, so building the site never needs a browser. Run
 * again after changing a clip or the share card:
 *
 *   pnpm --filter @coretask/site assets
 *
 * Remotion downloads its own headless Chrome on first use. To use one that is
 * already installed instead (Playwright's, say), point
 * REMOTION_BROWSER_EXECUTABLE at it.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import { automaticJsx } from '../src/remotion/webpack-override.ts';

const root = path.resolve(import.meta.dirname, '..');
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? null;

type Job = { id: string; output: string; frame: 'first' | 'last'; format: 'png' | 'webp' };

const JOBS: Job[] = [
  { id: 'og-image', output: 'public/og.png', frame: 'first', format: 'png' },
  {
    id: 'request-to-ticket',
    output: 'public/media/request-to-ticket.webp',
    frame: 'last',
    format: 'webp',
  },
  { id: 'rule-run', output: 'public/media/rule-run.webp', frame: 'last', format: 'webp' },
  {
    id: 'progress-rollup',
    output: 'public/media/progress-rollup.webp',
    frame: 'last',
    format: 'webp',
  },
];

const serveUrl = await bundle({
  entryPoint: path.join(root, 'src/remotion/index.ts'),
  webpackOverride: automaticJsx,
});
await mkdir(path.join(root, 'public/media'), { recursive: true });

for (const job of JOBS) {
  const composition = await selectComposition({ serveUrl, id: job.id, browserExecutable });
  const output = path.join(root, job.output);
  await renderStill({
    serveUrl,
    composition,
    output,
    frame: job.frame === 'last' ? composition.durationInFrames - 1 : 0,
    imageFormat: job.format,
    browserExecutable,
    overwrite: true,
  });
  console.warn(`rendered ${job.output}`);
}

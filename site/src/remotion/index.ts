/*
 * Entry point for Remotion's own tools — `pnpm studio` to preview and edit the
 * clips, and `pnpm assets` to render the posters and share card. The site
 * never imports this file; it imports the compositions through ./clips.
 */
import { loadFont as loadGeist } from '@remotion/google-fonts/Geist';
import { loadFont as loadGeistMono } from '@remotion/google-fonts/GeistMono';
import { registerRoot } from 'remotion';

import { RemotionRoot } from './root';

loadGeist('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] });
loadGeistMono('normal', { weights: ['400', '600'], subsets: ['latin'] });

registerRoot(RemotionRoot);

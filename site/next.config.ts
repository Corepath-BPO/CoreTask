import path from 'node:path';
import type { NextConfig } from 'next';

/*
 * Exported as plain HTML, CSS and JS: nginx (or any CDN) serves `out/` with no
 * Node.js at run time, the same way coretask-web ships. That rules out
 * server-only features such as on-demand image optimisation, so images are
 * served as they are committed.
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // `next dev` otherwise writes AGENTS.md and CLAUDE.md into the package.
  agentRules: false,
  // The monorepo root, stated rather than inferred: a git worktree nested
  // inside another checkout would otherwise resolve to the outer lockfile.
  turbopack: { root: path.resolve(process.cwd(), '..') },
};

export default config;

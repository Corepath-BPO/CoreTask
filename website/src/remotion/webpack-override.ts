import type { WebpackOverrideFn } from '@remotion/bundler';

/**
 * Compiles the clips with React's automatic JSX runtime.
 *
 * Remotion's loader learns the JSX mode by requiring TypeScript from beside
 * itself and reading tsconfig.json. pnpm keeps TypeScript out of the bundler's
 * reach, so the loader falls back to classic JSX and every clip fails with
 * "React is not defined". Shared by the renderer script and remotion.config.ts.
 */
export const automaticJsx: WebpackOverrideFn = (config) => {
  for (const rule of config.module?.rules ?? []) {
    if (!rule || typeof rule !== 'object' || !Array.isArray(rule.use)) continue;
    for (const use of rule.use) {
      if (
        use &&
        typeof use === 'object' &&
        typeof use.loader === 'string' &&
        use.loader.includes('esbuild-loader') &&
        use.options &&
        typeof use.options === 'object'
      ) {
        Object.assign(use.options, { jsx: 'automatic' });
      }
    }
  }
  return config;
};

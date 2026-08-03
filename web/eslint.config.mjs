import { reactConfig } from '@coretask/eslint-config/react';

export default [
  ...reactConfig,
  {
    // Vendored ShadCN primitives: kept close to upstream so they can be diffed
    // against `shadcn add` output.
    ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'src/components/ui/**'],
  },
];

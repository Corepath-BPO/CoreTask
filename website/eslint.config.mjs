import { reactConfig } from '@coretask/eslint-config/react';

export default [
  ...reactConfig,
  {
    ignores: ['.next/**', 'out/**', 'next-env.d.ts'],
  },
  {
    // Written for Vite's Fast Refresh. Next's route files export `metadata`,
    // `viewport` and friends beside the component by design.
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
];

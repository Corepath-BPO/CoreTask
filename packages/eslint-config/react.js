import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/** ESLint configuration for React + Vite packages. */
export const reactConfig = tseslint.config(
  ...baseConfig,
  // `configs.recommended` on this plugin is still the eslintrc shape (it
  // declares `plugins` as an array); the flat namespace is the one ESLint 9
  // accepts.
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // React Compiler cannot memoize react-hook-form's `watch`/`register`,
      // which return fresh functions by design. The diagnostic is accurate but
      // unactionable while RHF is the form library, and it fires on every form.
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    // Test helpers legitimately export utilities alongside render wrappers, and
    // Fast Refresh never applies to them.
    files: ['**/*.test.{ts,tsx}', '**/test/**', '**/e2e/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);

export default reactConfig;

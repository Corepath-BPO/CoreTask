import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/** ESLint configuration for Node.js / NestJS packages. */
export const nodeConfig = tseslint.config(...baseConfig, {
  languageOptions: {
    globals: { ...globals.node, ...globals.jest },
    sourceType: 'module',
  },
  rules: {
    // NestJS relies on parameter decorators and `interface`-shaped DTOs;
    // empty classes/interfaces are idiomatic there.
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-extraneous-class': 'off',

    // MUST stay off wherever `emitDecoratorMetadata` is on. The rule cannot see
    // that a constructor-injected class is needed at runtime for
    // `design:paramtypes`, so its autofix rewrites the import to `import type`
    // and dependency injection then fails at runtime with an undefined token.
    '@typescript-eslint/consistent-type-imports': 'off',
  },
});

export default nodeConfig;

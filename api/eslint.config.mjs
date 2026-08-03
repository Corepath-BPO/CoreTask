import { nodeConfig } from '@coretask/eslint-config/node';

export default [
  ...nodeConfig,
  {
    ignores: ['dist/**', 'coverage/**', 'prisma/migrations/**'],
  },
];

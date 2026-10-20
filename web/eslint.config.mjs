import { reactConfig } from '@coretask/eslint-config/react';

export default [
  ...reactConfig,
  {
    // Vendored ShadCN primitives: kept close to upstream so they can be diffed
    // against `shadcn add` output.
    ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'src/components/ui/**'],
  },
  {
    // user-event's own setup pauses a timer tick between actions, ~15ms each
    // on Windows, which was enough to time journeys out under the full suite.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@testing-library/user-event',
          message:
            "Use setupUser() from '@/test/test-utils'. It skips user-event's pause between actions.",
        },
      ],
    },
  },
];

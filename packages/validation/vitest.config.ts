import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Colocated with the source; tsup only bundles the `src/index.ts` graph, so
    // these files never reach the published output.
    include: ['src/**/*.test.ts'],
  },
});

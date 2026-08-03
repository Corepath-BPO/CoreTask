import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      // Bind mounts from a Windows host do not deliver inotify events to the
      // Linux container, so HMR needs polling there. Enabled by
      // CHOKIDAR_USEPOLLING in docker-compose.dev.yml only.
      usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
      interval: 400,
    },
  },

  preview: { host: true, port: 4173 },

  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        /**
         * Vendor code is split by library group so an app-code deploy only
         * invalidates the app chunk. A static `{ react: ['react'] }` map is not
         * enough — transitive imports still pull the framework into the entry
         * chunk, so the split has to be decided per module id.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@tanstack/react-router')) return 'router';
          if (id.includes('@tanstack/react-query')) return 'query';
          if (id.includes('@radix-ui')) return 'radix';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'realtime';
          if (/react-hook-form|@hookform|[\\/]zod[\\/]/.test(id)) return 'forms';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('@dnd-kit')) return 'dnd';

          return 'vendor';
        },
      },
    },
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // `e2e/` belongs to Playwright; Vitest would try to execute its
    // `test.describe` blocks and fail on the wrong runner.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
    },
  },
});

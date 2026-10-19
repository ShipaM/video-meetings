import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Loads apps/api/.env (DATABASE_URL, JWT_SECRET) before the app is created.
    setupFiles: ['dotenv/config'],
    env: {
      // The suites share the dev database: the scheduled cleanup must not touch its uploads.
      FILES_CLEANUP: 'off',
      // Jobs in their own pg-boss schema, so a running dev server never picks them up (or the
      // other way round).
      PGBOSS_SCHEMA: 'pgboss_e2e',
      JOBS_POLLING_INTERVAL_SECONDS: '0.5',
      // Short, so the "hangs past the timeout" case ends quickly.
      DOCUMENT_PROCESSING_TIMEOUT_SECONDS: '3',
      AI_PROVIDER: 'fake',
    },
    // Suites share one database.
    fileParallelism: false,
  },
});

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
      // A one-minute limit, so the over-limit recording is generated in a moment.
      MAX_RECORDING_MINUTES: '1',
      // A transcription timeout of seconds for the short test recordings (the hang case).
      TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS: '2',
      AI_PROVIDER: 'fake',
    },
    // Suites share one database.
    fileParallelism: false,
    // Tests wait for background jobs (up to 20 s, `settled`), and a cold first ffmpeg or worker
    // start on Windows can take seconds.
    testTimeout: 30_000,
  },
});

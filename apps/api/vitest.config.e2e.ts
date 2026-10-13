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
    // Suites share one database.
    fileParallelism: false,
  },
});

import { numberEnv } from '../config/env.js';

/** pg-boss settings, read from the environment (see `.env.example`). */

/** PostgreSQL schema of the pg-boss tables; Prisma only manages `public`. */
export function jobsSchema(): string {
  return process.env.PGBOSS_SCHEMA || 'pgboss';
}

/** How often a worker looks for new jobs, in seconds (pg-boss accepts 0.5 and up). */
export function jobsPollingIntervalSeconds(): number {
  return numberEnv('JOBS_POLLING_INTERVAL_SECONDS', 2, 0.5);
}

/** Longest wait for running jobs when the app stops; then their signals are aborted. */
export const JOBS_STOP_TIMEOUT_MS = 10_000;

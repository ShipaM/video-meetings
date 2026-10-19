import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { JOBS_STOP_TIMEOUT_MS, jobsSchema } from './jobs.config.js';

/**
 * The app's single pg-boss instance: persistent background jobs and schedules in the existing
 * PostgreSQL (own schema, so `prisma migrate` never sees its tables). Started before any
 * `onApplicationBootstrap`, so workers and producers can use it from there on.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);

  readonly boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: jobsSchema(),
    application_name: 'video-meetings-jobs',
  });

  async onModuleInit(): Promise<void> {
    this.boss.on('error', (error) => this.logger.error(`pg-boss: ${String(error)}`));
    await this.boss.start();
  }

  async onApplicationShutdown(): Promise<void> {
    // Running jobs get a moment to finish; an interrupted one is retried after the restart.
    await this.boss.stop({ graceful: true, timeout: JOBS_STOP_TIMEOUT_MS });
  }
}

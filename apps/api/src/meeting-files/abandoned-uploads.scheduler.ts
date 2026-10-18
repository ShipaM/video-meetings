import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CleanupAbandonedUploadsCommand, SweepOrphanFilesCommand } from './commands/index.js';
import { CLEANUP_INTERVAL_MS, filesCleanupEnabled } from './meeting-files.config.js';

/**
 * Runs `CleanupAbandonedUploadsCommand` and then `SweepOrphanFilesCommand` at startup and every
 * `CLEANUP_INTERVAL_MS`, unless `FILES_CLEANUP=off` (e2e tests). A plain in-process timer is enough
 * for one API instance; it moves to a pg-boss schedule together with the processing jobs (Phase 7).
 */
@Injectable()
export class AbandonedUploadsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AbandonedUploadsScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly commandBus: CommandBus) {}

  onApplicationBootstrap(): void {
    if (!filesCleanupEnabled()) {
      return;
    }
    void this.run();
    // unref: the timer alone never keeps the process alive.
    this.timer = setInterval(() => void this.run(), CLEANUP_INTERVAL_MS).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const abandoned = await this.commandBus.execute(new CleanupAbandonedUploadsCommand());
      const orphans = await this.commandBus.execute(new SweepOrphanFilesCommand());
      if (abandoned + orphans > 0) {
        this.logger.log(`Removed ${abandoned} abandoned upload(s) and ${orphans} orphan file(s)`);
      }
    } catch (error) {
      this.logger.error(`Storage cleanup failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}

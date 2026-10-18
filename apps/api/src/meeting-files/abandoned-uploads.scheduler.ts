import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CleanupAbandonedUploadsCommand } from './commands/index.js';
import { CLEANUP_INTERVAL_MS } from './meeting-files.config.js';

/**
 * Runs `CleanupAbandonedUploadsCommand` at startup and then every `CLEANUP_INTERVAL_MS`. A plain
 * in-process timer is enough for one API instance; it moves to a pg-boss schedule together with
 * the processing jobs (Phase 7).
 */
@Injectable()
export class AbandonedUploadsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AbandonedUploadsScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly commandBus: CommandBus) {}

  onApplicationBootstrap(): void {
    void this.run();
    // unref: the timer alone never keeps the process (or a test run) alive.
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
      const removed = await this.commandBus.execute(new CleanupAbandonedUploadsCommand());
      if (removed > 0) {
        this.logger.log(`Removed ${removed} abandoned upload(s)`);
      }
    } catch (error) {
      this.logger.error(`Abandoned upload cleanup failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}

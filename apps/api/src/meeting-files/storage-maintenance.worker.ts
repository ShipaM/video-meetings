import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { jobsPollingIntervalSeconds } from '../jobs/jobs.config.js';
import { JobsService } from '../jobs/jobs.service.js';
import {
  CleanupAbandonedUploadsCommand,
  FailStuckProcessingCommand,
  SweepOrphanFilesCommand,
} from './commands/index.js';
import { STORAGE_MAINTENANCE_CRON, filesCleanupEnabled } from './meeting-files.config.js';

export const STORAGE_MAINTENANCE_QUEUE = 'storage-maintenance';

/**
 * Hourly maintenance as a pg-boss schedule (plus one run at startup): removes abandoned uploads
 * and orphan files, then fails files stuck in `PROCESSING`. The `singleton` queue policy keeps
 * runs from overlapping, also across API instances. `FILES_CLEANUP=off` (e2e tests) disables it.
 */
@Injectable()
export class StorageMaintenanceWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageMaintenanceWorker.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly commandBus: CommandBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!filesCleanupEnabled()) {
      return;
    }
    const { boss } = this.jobs;
    await boss.createQueue(STORAGE_MAINTENANCE_QUEUE, { policy: 'singleton', retryLimit: 0 });
    await boss.schedule(STORAGE_MAINTENANCE_QUEUE, STORAGE_MAINTENANCE_CRON);
    await boss.work(
      STORAGE_MAINTENANCE_QUEUE,
      { pollingIntervalSeconds: jobsPollingIntervalSeconds() },
      () => this.run(),
    );
    await boss.send(STORAGE_MAINTENANCE_QUEUE);
  }

  private async run(): Promise<void> {
    try {
      const abandoned = await this.commandBus.execute(new CleanupAbandonedUploadsCommand());
      const orphans = await this.commandBus.execute(new SweepOrphanFilesCommand());
      const stuck = await this.commandBus.execute(new FailStuckProcessingCommand());
      if (abandoned + orphans + stuck > 0) {
        this.logger.log(
          `Removed ${abandoned} abandoned upload(s) and ${orphans} orphan file(s), ` +
            `failed ${stuck} stuck file(s)`,
        );
      }
    } catch (error) {
      this.logger.error(`Storage maintenance failed: ${String(error)}`);
      throw error;
    }
  }
}

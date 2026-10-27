import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { SweepOrphanFilesCommand } from '../sweep-orphan-files.command.js';

/** Storage keys looked up per query. */
const BATCH_SIZE = 500;

@CommandHandler(SweepOrphanFilesCommand)
export class SweepOrphanFilesHandler implements ICommandHandler<SweepOrphanFilesCommand> {
  private readonly logger = new Logger(SweepOrphanFilesHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ olderThan }: SweepOrphanFilesCommand): Promise<number> {
    // The row is created before tus writes the file and keys are never reused, so an old file
    // without a row can never get one.
    const candidates = (await this.storage.storedEntries())
      .filter(({ modifiedAt }) => modifiedAt < olderThan)
      .map(({ storageKey }) => storageKey);

    let removed = 0;
    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const keys = candidates.slice(start, start + BATCH_SIZE);
      const rows = await this.prisma.meetingFile.findMany({
        where: { storageKey: { in: keys } },
        select: { storageKey: true },
      });
      const known = new Set(rows.map(({ storageKey }) => storageKey));
      const results = await Promise.all(
        keys
          .filter((key) => !known.has(key))
          .map((key) => this.storage.removeQuietly(key, `orphan file ${key}`)),
      );
      removed += results.filter(Boolean).length;
    }
    return removed + (await this.sweepWorkDirs(olderThan));
  }

  /**
   * Work directories a job left behind (a crash, a failed removal). The directory of the attempt a
   * file is `PROCESSING` with may belong to a running job, which clears it when it ends; every
   * other attempt's directory is stale, and a retry never reuses it (it gets a new attempt).
   */
  private async sweepWorkDirs(olderThan: Date): Promise<number> {
    const candidates = (await this.storage.workDirs()).filter(
      ({ modifiedAt }) => modifiedAt < olderThan,
    );
    if (candidates.length === 0) {
      return 0;
    }
    const running = await this.prisma.meetingFile.findMany({
      where: {
        id: { in: [...new Set(candidates.map(({ fileId }) => fileId))] },
        status: 'PROCESSING',
      },
      select: { id: true, processingAttempt: true },
    });
    const busy = new Set(running.map(({ id, processingAttempt }) => `${id}.${processingAttempt}`));
    let removed = 0;
    for (const { fileId, attempt } of candidates) {
      if (busy.has(`${fileId}.${attempt}`)) {
        continue;
      }
      try {
        await this.storage.removeWorkDir(fileId, attempt);
        removed += 1;
      } catch (error) {
        this.logger.warn(
          `Could not remove the work directory of ${fileId} (attempt ${attempt}): ${String(error)}`,
        );
      }
    }
    return removed;
  }
}

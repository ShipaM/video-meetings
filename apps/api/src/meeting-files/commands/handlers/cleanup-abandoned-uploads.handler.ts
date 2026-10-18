import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { ABANDONED_UPLOAD_MS } from '../../meeting-files.config.js';
import { CleanupAbandonedUploadsCommand } from '../cleanup-abandoned-uploads.command.js';

@CommandHandler(CleanupAbandonedUploadsCommand)
export class CleanupAbandonedUploadsHandler implements ICommandHandler<CleanupAbandonedUploadsCommand> {
  private readonly logger = new Logger(CleanupAbandonedUploadsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
  ) {}

  async execute(): Promise<number> {
    const abandoned = {
      status: 'UPLOADING' as const,
      lastChunkAt: { lt: new Date(Date.now() - ABANDONED_UPLOAD_MS) },
    };
    const files = await this.prisma.meetingFile.findMany({
      where: abandoned,
      select: { id: true, storageKey: true },
    });

    let removed = 0;
    for (const { id, storageKey } of files) {
      // Re-checked in the delete: a chunk that arrived meanwhile keeps the upload alive.
      const { count } = await this.prisma.meetingFile.deleteMany({ where: { id, ...abandoned } });
      if (count === 0) {
        continue;
      }
      removed += 1;
      // Row first, then data: a crash in between leaves an orphan file, never a row without data.
      try {
        await this.storage.remove(storageKey);
      } catch (error) {
        // The upload is gone either way; only its disk space is left behind.
        this.logger.warn(`Could not remove the data of abandoned upload ${id}: ${String(error)}`);
      }
    }
    return removed;
  }
}

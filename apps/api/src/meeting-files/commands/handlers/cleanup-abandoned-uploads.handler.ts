import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { CleanupAbandonedUploadsCommand } from '../cleanup-abandoned-uploads.command.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';

/** Rows handled per query, so a large backlog never loads at once. */
const BATCH_SIZE = 100;

interface Candidate {
  id: string;
  storageKey: string;
  size: bigint;
}

@CommandHandler(CleanupAbandonedUploadsCommand)
export class CleanupAbandonedUploadsHandler implements ICommandHandler<CleanupAbandonedUploadsCommand> {
  private readonly logger = new Logger(CleanupAbandonedUploadsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commandBus: CommandBus,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ cutoff }: CleanupAbandonedUploadsCommand): Promise<number> {
    let removed = 0;
    let afterId: string | undefined;
    for (;;) {
      // Keyset pagination: rows that stay (completed instead) are not read again.
      const batch = await this.prisma.meetingFile.findMany({
        where: {
          status: 'UPLOADING',
          lastChunkAt: { lt: cutoff },
          ...(afterId && { id: { gt: afterId } }),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, storageKey: true, size: true },
      });
      const results = await Promise.all(batch.map((file) => this.cleanUp(file, cutoff)));
      removed += results.filter(Boolean).length;
      if (batch.length < BATCH_SIZE) {
        return removed;
      }
      afterId = batch[batch.length - 1].id;
    }
  }

  private async cleanUp({ id, storageKey, size }: Candidate, cutoff: Date): Promise<boolean> {
    // All bytes are stored, only the completion failed and the client never retried it: finish the
    // upload instead of throwing a complete file away.
    if ((await this.storage.storedBytes(storageKey)) === Number(size)) {
      try {
        await this.commandBus.execute(new CompleteUploadCommand(id));
      } catch (error) {
        this.logger.warn(`Could not complete stalled upload ${id}: ${String(error)}`);
      }
      return false;
    }

    // Re-checked in the delete: a chunk that arrived meanwhile keeps the upload alive.
    const { count } = await this.prisma.meetingFile.deleteMany({
      where: { id, status: 'UPLOADING', lastChunkAt: { lt: cutoff } },
    });
    if (count === 0) {
      return false;
    }
    // Row first, then data: a crash in between leaves an orphan file, never a row without data.
    await this.storage.removeQuietly(storageKey, `abandoned upload ${id}`);
    return true;
  }
}

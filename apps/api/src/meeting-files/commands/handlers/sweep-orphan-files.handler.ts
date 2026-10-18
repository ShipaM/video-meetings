import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { SweepOrphanFilesCommand } from '../sweep-orphan-files.command.js';

/** Storage keys looked up per query. */
const BATCH_SIZE = 500;

@CommandHandler(SweepOrphanFilesCommand)
export class SweepOrphanFilesHandler implements ICommandHandler<SweepOrphanFilesCommand> {
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
    return removed;
  }
}

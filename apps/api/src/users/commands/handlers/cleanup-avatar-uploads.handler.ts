import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { CleanupAvatarUploadsCommand } from '../cleanup-avatar-uploads.command.js';

/** Rows handled per query, so a large backlog never loads at once. */
const BATCH_SIZE = 100;

/** Unfinished uploads and finished ones never attached to a profile, with no chunk since `cutoff`. */
const removable = (cutoff: Date): Prisma.UserAvatarWhereInput => ({
  lastChunkAt: { lt: cutoff },
  OR: [{ status: 'UPLOADING' }, { status: 'READY', currentOf: { is: null } }],
});

@CommandHandler(CleanupAvatarUploadsCommand)
export class CleanupAvatarUploadsHandler implements ICommandHandler<CleanupAvatarUploadsCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ cutoff }: CleanupAvatarUploadsCommand): Promise<number> {
    let removed = 0;
    let afterId: string | undefined;
    for (;;) {
      // Keyset pagination: rows that stay (attached or uploading again) are not read again.
      const batch = await this.prisma.userAvatar.findMany({
        where: { ...removable(cutoff), ...(afterId && { id: { gt: afterId } }) },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true },
      });
      const results = await Promise.all(batch.map(({ id }) => this.cleanUp(id, cutoff)));
      removed += results.filter(Boolean).length;
      if (batch.length < BATCH_SIZE) {
        return removed;
      }
      afterId = batch[batch.length - 1].id;
    }
  }

  private async cleanUp(id: string, cutoff: Date): Promise<boolean> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      // Locked first: attaching the avatar holds a key-share lock on this row until its commit, so
      // the delete below starts only afterwards and sees the attachment. Re-checked in the delete:
      // a chunk or an attachment that arrived meanwhile keeps the avatar.
      await tx.$queryRaw`SELECT id FROM "UserAvatar" WHERE id = ${id} FOR UPDATE`;
      const { count } = await tx.userAvatar.deleteMany({ where: { id, ...removable(cutoff) } });
      return count > 0;
    });
    if (!deleted) {
      return false;
    }
    // Row first, then data: a crash in between leaves an orphan file, never a row without data.
    await this.storage.removeQuietly(id, `abandoned avatar upload ${id}`);
    return true;
  }
}

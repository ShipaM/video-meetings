import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CancelAvatarUploadCommand } from '../cancel-avatar-upload.command.js';

/**
 * Deletes only the row: tus removes the data right after this, under its upload lock (which also
 * stops a chunk still being written). Row first, then data, so a crash or a failed removal leaves
 * an orphan file, never a row without data.
 */
@CommandHandler(CancelAvatarUploadCommand)
export class CancelAvatarUploadHandler implements ICommandHandler<CancelAvatarUploadCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, uploadId }: CancelAvatarUploadCommand): Promise<void> {
    // One conditional delete: only the user's upload, and only while it is UPLOADING, so a
    // completion that wins the race keeps its avatar (and its data).
    const { count } = await this.prisma.userAvatar.deleteMany({
      where: { id: uploadId, userId, status: 'UPLOADING' },
    });
    if (count > 0) {
      return;
    }

    const avatar = await this.prisma.userAvatar.findUnique({
      where: { id: uploadId },
      select: { userId: true },
    });
    if (avatar?.userId !== userId) {
      throw new NotFoundException('Upload not found');
    }
    throw new ConflictException('Upload is already complete');
  }
}

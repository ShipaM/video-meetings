import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { avatarContentMatches } from '../../avatar-types.js';
import { CompleteAvatarUploadCommand } from '../complete-avatar-upload.command.js';

/**
 * Idempotent: it may run twice for one upload (the last PATCH and a retried HEAD), so every write
 * is conditional on the avatar still being UPLOADING.
 */
@CommandHandler(CompleteAvatarUploadCommand)
export class CompleteAvatarUploadHandler implements ICommandHandler<CompleteAvatarUploadCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ uploadId }: CompleteAvatarUploadCommand): Promise<void> {
    const avatar = await this.prisma.userAvatar.findUnique({ where: { id: uploadId } });
    if (!avatar) {
      throw new NotFoundException('Upload not found');
    }
    if (avatar.status !== 'UPLOADING') {
      return;
    }

    if (!(await avatarContentMatches(this.storage.pathOf(uploadId), avatar.mimeType))) {
      // Row first, then data: a crash in between leaves an orphan file, never a row without data.
      await this.prisma.userAvatar.deleteMany({ where: { id: uploadId, status: 'UPLOADING' } });
      await this.storage.removeQuietly(uploadId, `mismatched avatar upload ${uploadId}`);
      throw new BadRequestException('File content does not match its type');
    }

    const { count } = await this.prisma.userAvatar.updateMany({
      where: { id: uploadId, status: 'UPLOADING' },
      data: { status: 'READY' },
    });
    // Nothing updated: either a concurrent completion won (fine) or the upload is gone (cancelled
    // or cleaned up meanwhile), which is not a server error.
    if (count === 0 && !(await this.prisma.userAvatar.findUnique({ where: { id: uploadId } }))) {
      throw new NotFoundException('Upload not found');
    }
  }
}

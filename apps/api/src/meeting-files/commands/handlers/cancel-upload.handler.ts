import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CancelUploadCommand } from '../cancel-upload.command.js';

/**
 * Deletes only the row: tus removes the data right after this, under its upload lock (which also
 * stops a chunk still being written). Row first, then data, so a crash leaves an orphan file, never
 * a row without data.
 */
@CommandHandler(CancelUploadCommand)
export class CancelUploadHandler implements ICommandHandler<CancelUploadCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, fileId }: CancelUploadCommand): Promise<void> {
    // Only the uploader may cancel an upload; anyone else cannot tell it exists.
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, uploadedById: userId },
      select: { id: true },
    });
    if (!file) {
      throw new NotFoundException('Upload not found');
    }

    // Conditional, so a completion that wins the race keeps its file (and its data).
    const { count } = await this.prisma.meetingFile.deleteMany({
      where: { id: fileId, status: 'UPLOADING' },
    });
    if (count === 0) {
      throw new ConflictException('Upload is already complete; delete the file instead');
    }
  }
}

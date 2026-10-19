import { ConflictException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { requireOwnUpload } from '../../upload-access.js';
import { CancelUploadCommand } from '../cancel-upload.command.js';

/**
 * Deletes only the row: tus removes the data right after this, under its upload lock (which also
 * stops a chunk still being written). Row first, then data, so a crash or a failed removal leaves
 * an orphan file (removed by the orphan sweep), never a row without data.
 */
@CommandHandler(CancelUploadCommand)
export class CancelUploadHandler implements ICommandHandler<CancelUploadCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, fileId }: CancelUploadCommand): Promise<void> {
    // One conditional delete: only the uploader's upload, and only while it is UPLOADING, so a
    // completion that wins the race keeps its file (and its data).
    const { count } = await this.prisma.meetingFile.deleteMany({
      where: { id: fileId, uploadedById: userId, status: 'UPLOADING' },
    });
    if (count > 0) {
      return;
    }

    // Nothing deleted: tell a completed upload from one that is not the caller's (a single read,
    // so the answer cannot mix two states of the row).
    const file = await this.prisma.meetingFile.findUnique({
      where: { id: fileId },
      select: { uploadedById: true, meetingId: true },
    });
    await requireOwnUpload(this.queryBus, userId, file);
    throw new ConflictException('Upload is already complete; delete the file instead');
  }
}

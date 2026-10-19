import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import type { MeetingFile } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { rejectForeignUpload } from '../../upload-access.js';
import { AuthorizeUploadRequestCommand } from '../authorize-upload-request.command.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';

@CommandHandler(AuthorizeUploadRequestCommand)
export class AuthorizeUploadRequestHandler implements ICommandHandler<AuthorizeUploadRequestCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ userId, fileId, method }: AuthorizeUploadRequestCommand): Promise<MeetingFile> {
    // Only the uploader may continue an upload.
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, uploadedById: userId },
    });
    if (!file) {
      return rejectForeignUpload(this.prisma, this.queryBus, userId, fileId);
    }
    if (file.status !== 'UPLOADING') {
      // HEAD of a finished upload is fine (the client learns it is done); writing is not.
      if (method === 'PATCH') {
        throw new ConflictException('Upload is already complete');
      }
      return file;
    }

    // All bytes stored but still UPLOADING: the completion hook failed (e.g. a database error) and
    // tus will not call it again, so the client's retry (HEAD, then maybe PATCH) completes it.
    const stored = await this.storage.store.getUpload(file.storageKey);
    if (stored.offset === Number(file.size)) {
      return this.commandBus.execute(new CompleteUploadCommand(fileId));
    }

    if (method === 'PATCH') {
      // The start of each chunk; abandoned uploads are found by this timestamp. Conditional, because
      // a cancel or the cleanup may have deleted the row since it was read.
      const lastChunkAt = new Date();
      const { count } = await this.prisma.meetingFile.updateMany({
        where: { id: fileId, status: 'UPLOADING' },
        data: { lastChunkAt },
      });
      if (count === 0) {
        throw new NotFoundException('Upload not found');
      }
      return { ...file, lastChunkAt };
    }
    return file;
  }
}

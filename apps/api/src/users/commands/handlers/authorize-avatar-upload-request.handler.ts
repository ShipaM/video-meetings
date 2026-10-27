import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { AuthorizeAvatarUploadRequestCommand } from '../authorize-avatar-upload-request.command.js';
import { CompleteAvatarUploadCommand } from '../complete-avatar-upload.command.js';

@CommandHandler(AuthorizeAvatarUploadRequestCommand)
export class AuthorizeAvatarUploadRequestHandler implements ICommandHandler<AuthorizeAvatarUploadRequestCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandBus: CommandBus,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ userId, uploadId, method }: AuthorizeAvatarUploadRequestCommand): Promise<void> {
    const avatar = await this.prisma.userAvatar.findUnique({ where: { id: uploadId } });
    // Only the uploader may continue an upload; anybody else gets 404, as for a missing one.
    if (avatar?.userId !== userId) {
      throw new NotFoundException('Upload not found');
    }
    if (avatar.status !== 'UPLOADING') {
      // HEAD of a finished upload is fine (the client learns it is done); writing is not.
      if (method === 'PATCH') {
        throw new ConflictException('Upload is already complete');
      }
      return;
    }

    // All bytes stored but still UPLOADING: the completion hook failed (e.g. a database error) and
    // tus will not call it again, so the client's retry (HEAD, then maybe PATCH) completes it.
    const stored = await this.storage.store.getUpload(uploadId);
    if (stored.offset === avatar.size) {
      return this.commandBus.execute(new CompleteAvatarUploadCommand(uploadId));
    }

    if (method === 'PATCH') {
      // The start of each chunk; abandoned uploads are found by this timestamp. Conditional, because
      // a cancel or the cleanup may have deleted the row since it was read.
      const { count } = await this.prisma.userAvatar.updateMany({
        where: { id: uploadId, status: 'UPLOADING' },
        data: { lastChunkAt: new Date() },
      });
      if (count === 0) {
        throw new NotFoundException('Upload not found');
      }
    }
  }
}

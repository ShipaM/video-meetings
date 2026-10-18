import { Logger, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { DeleteMeetingFileCommand } from '../delete-meeting-file.command.js';

@CommandHandler(DeleteMeetingFileCommand)
export class DeleteMeetingFileHandler implements ICommandHandler<DeleteMeetingFileCommand> {
  private readonly logger = new Logger(DeleteMeetingFileHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ userId, meetingId, fileId }: DeleteMeetingFileCommand): Promise<void> {
    // Throws 404 for a missing meeting or one owned by somebody else.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId));

    // An upload in progress is cancelled through tus (`DELETE /uploads/:id`), not deleted here.
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, status: { not: 'UPLOADING' } },
      select: { storageKey: true },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Row first, then data: a crash in between leaves an orphan file, never a row without data.
    // The row is what grants access, so links issued earlier stop working from here on.
    const { count } = await this.prisma.meetingFile.deleteMany({
      where: { id: fileId, meetingId },
    });
    if (count === 0) {
      throw new NotFoundException('File not found');
    }
    try {
      await this.storage.remove(file.storageKey);
    } catch (error) {
      // The file is gone for every user; only its disk space is left behind.
      this.logger.warn(`Could not remove the data of deleted file ${fileId}: ${String(error)}`);
    }
  }
}

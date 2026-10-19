import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { DeleteMeetingFileCommand } from '../delete-meeting-file.command.js';

@CommandHandler(DeleteMeetingFileCommand)
export class DeleteMeetingFileHandler implements ICommandHandler<DeleteMeetingFileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ userId, meetingId, fileId }: DeleteMeetingFileCommand): Promise<void> {
    // Only the owner deletes: 404 for a missing or foreign meeting, 403 for a participant.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

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
    // A download still streaming the file may keep it busy (Windows); the orphan sweep retries.
    await this.storage.removeQuietly(file.storageKey, `deleted file ${fileId}`);
  }
}

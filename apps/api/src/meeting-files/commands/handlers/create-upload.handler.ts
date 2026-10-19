import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import type { MeetingFile } from '../../../generated/prisma/client.js';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { resolveFileType } from '../../file-types.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { ABANDONED_UPLOAD_MS } from '../../meeting-files.config.js';
import { CreateUploadCommand } from '../create-upload.command.js';

/** Free space kept on the disk on top of the upload itself. */
const DISK_RESERVE_BYTES = 512 * 1024 ** 2;

@CommandHandler(CreateUploadCommand)
export class CreateUploadHandler implements ICommandHandler<CreateUploadCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ userId, uploadId, size, metadata }: CreateUploadCommand): Promise<MeetingFile> {
    const { meetingId, filename, filetype } = metadata;
    if (!meetingId || !filename) {
      throw new BadRequestException('Upload metadata must contain meetingId and filename');
    }

    // Only the owner uploads: 404 for a missing or foreign meeting, 403 for a participant.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

    // Keep only the last path segment of whatever the client sent.
    const originalName = filename.split(/[\\/]/).pop()?.trim() ?? '';
    const type = originalName ? resolveFileType(originalName, filetype ?? '') : null;
    if (!type) {
      throw new BadRequestException('File type is not allowed');
    }

    const [free, promised] = await Promise.all([this.storage.freeBytes(), this.promisedBytes()]);
    if (free - promised < size + DISK_RESERVE_BYTES) {
      throw new HttpException('Not enough storage space', HttpStatus.INSUFFICIENT_STORAGE);
    }

    return this.prisma.meetingFile.create({
      data: {
        id: uploadId,
        meetingId,
        uploadedById: userId,
        originalName,
        mimeType: type.mimeType,
        kind: type.kind,
        size: BigInt(size),
        storageKey: uploadId,
      },
    });
  }

  /** Bytes that active (not abandoned) uploads still have to write, so parallel uploads fit. */
  private async promisedBytes(): Promise<number> {
    const active = await this.prisma.meetingFile.findMany({
      where: {
        status: 'UPLOADING',
        lastChunkAt: { gte: new Date(Date.now() - ABANDONED_UPLOAD_MS) },
      },
      select: { size: true, storageKey: true },
    });
    const remaining = await Promise.all(
      active.map(
        async ({ size, storageKey }) => Number(size) - (await this.storage.storedBytes(storageKey)),
      ),
    );
    return remaining.reduce((sum, bytes) => sum + Math.max(bytes, 0), 0);
  }
}

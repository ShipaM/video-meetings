import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { MeetingFile } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { contentMatchesType } from '../../file-types.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { ProcessingQueue } from '../../processing/processing-queue.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';

/**
 * Idempotent: it may run twice for one upload (the last PATCH and a retried HEAD), so every write
 * is conditional on the file still being UPLOADING.
 */
@CommandHandler(CompleteUploadCommand)
export class CompleteUploadHandler implements ICommandHandler<CompleteUploadCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
    private readonly processing: ProcessingQueue,
  ) {}

  async execute({ fileId }: CompleteUploadCommand): Promise<MeetingFile> {
    const file = await this.prisma.meetingFile.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException('Upload not found');
    }
    if (file.status !== 'UPLOADING') {
      return file;
    }

    if (!(await contentMatchesType(this.storage.pathOf(file.storageKey), file.mimeType))) {
      // Row first, then data: a crash in between leaves an orphan file, never a row without data.
      await this.prisma.meetingFile.deleteMany({ where: { id: fileId, status: 'UPLOADING' } });
      await this.storage.removeQuietly(file.storageKey, `mismatched upload ${fileId}`);
      throw new BadRequestException('File content does not match its type');
    }

    // Documents are summarized in the background; images (and, until Phase 9, recordings) are
    // ready at once.
    if (file.kind === 'DOCUMENT') {
      // Status and job commit together; only the call that made the change queues the job
      // (completion may run twice).
      await this.prisma.$transaction(async (tx) => {
        const [processing] = await tx.meetingFile.updateManyAndReturn({
          where: { id: fileId, status: 'UPLOADING' },
          data: {
            status: 'PROCESSING',
            completedAt: new Date(),
            processingAttempt: { increment: 1 },
          },
        });
        if (processing) {
          await this.processing.queue(tx, fileId, processing.processingAttempt);
        }
      });
    } else {
      await this.prisma.meetingFile.updateMany({
        where: { id: fileId, status: 'UPLOADING' },
        data: { status: 'READY', completedAt: new Date() },
      });
    }
    // Cancelled or cleaned up meanwhile: the upload is gone, not a server error.
    const completed = await this.prisma.meetingFile.findUnique({ where: { id: fileId } });
    if (!completed) {
      throw new NotFoundException('Upload not found');
    }
    return completed;
  }
}

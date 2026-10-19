import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingFileDetails, toMeetingFileDetails } from '../../meeting-files.types.js';
import { ProcessingQueue } from '../../processing/processing-queue.js';
import { RetryFileProcessingCommand } from '../retry-file-processing.command.js';

@CommandHandler(RetryFileProcessingCommand)
export class RetryFileProcessingHandler implements ICommandHandler<RetryFileProcessingCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly processing: ProcessingQueue,
  ) {}

  async execute({
    userId,
    meetingId,
    fileId,
  }: RetryFileProcessingCommand): Promise<MeetingFileDetails> {
    // Only the owner retries: 404 for a missing or foreign meeting, 403 for a participant.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

    // A new attempt and its job commit together. The update is conditional, so two retries at
    // once start one attempt; only documents are processed so far (recordings: Phase 9).
    const retried = await this.prisma.$transaction(async (tx) => {
      const [processing] = await tx.meetingFile.updateManyAndReturn({
        where: { id: fileId, meetingId, status: 'FAILED', kind: 'DOCUMENT' },
        data: { status: 'PROCESSING', failureReason: null, processingAttempt: { increment: 1 } },
      });
      if (processing) {
        await this.processing.queue(tx, fileId, processing.processingAttempt);
      }
      return processing;
    });

    if (!retried) {
      // Nothing changed: tell a missing file from one that cannot be retried.
      const file = await this.prisma.meetingFile.findFirst({
        where: { id: fileId, meetingId, status: { not: 'UPLOADING' } },
        select: { id: true },
      });
      throw file
        ? new ConflictException('Only failed documents can be retried')
        : new NotFoundException('File not found');
    }
    // A FAILED file has no summary: the summary is only stored together with READY.
    return toMeetingFileDetails({ ...retried, summary: null });
  }
}

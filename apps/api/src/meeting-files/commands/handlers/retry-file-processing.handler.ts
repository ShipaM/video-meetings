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

    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, status: { not: 'UPLOADING' } },
      select: { kind: true },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }
    // Only documents are processed so far (recordings: Phase 9).
    if (file.kind !== 'DOCUMENT') {
      throw new ConflictException('Only failed documents can be retried');
    }

    // Conditional, so two retries at once start one new attempt.
    const { count } = await this.prisma.meetingFile.updateMany({
      where: { id: fileId, meetingId, status: 'FAILED' },
      data: { status: 'PROCESSING', failureReason: null, processingAttempt: { increment: 1 } },
    });
    if (count === 0) {
      throw new ConflictException('Only failed documents can be retried');
    }
    const retried = await this.prisma.meetingFile.findUnique({
      where: { id: fileId },
      include: { summary: true },
    });
    if (!retried) {
      throw new NotFoundException('File not found'); // deleted meanwhile
    }
    await this.processing.start(fileId, retried.processingAttempt);
    return toMeetingFileDetails(retried);
  }
}

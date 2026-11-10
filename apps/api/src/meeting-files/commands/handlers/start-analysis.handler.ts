import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { RECORDING_KINDS } from '../../file-types.js';
import type { MeetingFileDetails } from '../../meeting-files.types.js';
import { ProcessingQueue } from '../../processing/processing-queue.js';
import { GetMeetingFileQuery } from '../../queries/get-meeting-file.query.js';
import { StartAnalysisCommand } from '../start-analysis.command.js';

@CommandHandler(StartAnalysisCommand)
export class StartAnalysisHandler implements ICommandHandler<StartAnalysisCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly processing: ProcessingQueue,
  ) {}

  async execute({ userId, meetingId, fileId }: StartAnalysisCommand): Promise<MeetingFileDetails> {
    // Only the owner starts it: 404 for a missing or foreign meeting, 403 for a participant.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

    // The status and its job commit together. The update is conditional (no analysis RUNNING), so
    // two requests at once start one analysis; the file stays READY with its transcript and summary.
    const started = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.meetingFile.updateMany({
        where: {
          id: fileId,
          meetingId,
          status: 'READY',
          kind: { in: [...RECORDING_KINDS] },
          OR: [{ analysisStatus: null }, { analysisStatus: 'FAILED' }],
          insights: { is: null },
          transcript: { some: {} },
        },
        data: { analysisStatus: 'RUNNING' },
      });
      if (count > 0) {
        await this.processing.queueAnalysis(tx, fileId);
      }
      return count > 0;
    });

    if (!started) {
      // Nothing changed: tell a missing file from one that cannot be analyzed.
      const file = await this.prisma.meetingFile.findFirst({
        where: { id: fileId, meetingId, status: { not: 'UPLOADING' } },
        select: { id: true },
      });
      throw file
        ? new ConflictException(
            'Only a ready recording with a transcript and no insights can be analyzed',
          )
        : new NotFoundException('File not found');
    }
    return this.queryBus.execute(new GetMeetingFileQuery(userId, meetingId, fileId));
  }
}

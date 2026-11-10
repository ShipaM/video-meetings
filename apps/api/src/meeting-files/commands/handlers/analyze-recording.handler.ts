import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { MeetingAnalyzer } from '../../processing/meeting-analyzer.js';
import { transcriptSummaryTimeoutMs } from '../../processing/processing.config.js';
import { SummaryError } from '../../processing/summarizer.js';
import { AnalyzeRecordingCommand } from '../analyze-recording.command.js';

/** Writing the insights and removing the old summary; like the recording job's result. */
const RESULT_TRANSACTION_TIMEOUT_MS = 60_000;

@CommandHandler(AnalyzeRecordingCommand)
export class AnalyzeRecordingHandler implements ICommandHandler<AnalyzeRecordingCommand> {
  private readonly logger = new Logger(AnalyzeRecordingHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyzer: MeetingAnalyzer,
  ) {}

  async execute({ fileId, signal }: AnalyzeRecordingCommand): Promise<void> {
    // Every write below is conditional on this: the file is still READY with a RUNNING analysis.
    const running = { id: fileId, status: 'READY', analysisStatus: 'RUNNING' } as const;
    const file = await this.prisma.meetingFile.findFirst({
      where: running,
      select: { durationMs: true },
    });
    if (!file) {
      return; // deleted, or the analysis has already ended
    }

    // The analysis has its own timeout; only an abort of the job's signal is a shutdown.
    const timeout = AbortSignal.timeout(transcriptSummaryTimeoutMs(file.durationMs ?? 0));
    try {
      const segments = await this.prisma.transcriptSegment.findMany({
        where: { fileId },
        orderBy: { position: 'asc' },
        select: { text: true },
      });
      const insights = await this.analyzer.analyze(
        segments.map((segment) => segment.text).join('\n'),
        AbortSignal.any([signal, timeout]),
      );
      const actionItems = insights.actionItems.map(({ description, assignee }, position) => ({
        position,
        description,
        assignee,
      }));
      const decisions = insights.decisions.map(({ text }, position) => ({ position, text }));

      // Status, insights and the old summary together: a file deleted meanwhile gets nothing back.
      await this.prisma.$transaction(
        async (tx) => {
          const { count } = await tx.meetingFile.updateMany({
            where: running,
            data: { analysisStatus: null },
          });
          if (count > 0) {
            await tx.recordingInsights.deleteMany({ where: { fileId } });
            await tx.recordingInsights.create({
              data: {
                fileId,
                summary: insights.summary,
                actionItems: { createMany: { data: actionItems } },
                decisions: { createMany: { data: decisions } },
              },
            });
            await tx.meetingFileSummary.deleteMany({ where: { fileId } });
          }
        },
        { timeout: RESULT_TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (signal.aborted) {
        throw error; // shutdown or expiration: pg-boss retries the job
      }
      if (!(error instanceof SummaryError) && !timeout.aborted) {
        this.logger.error(`Analysis of a recording failed unexpectedly: ${String(error)}`);
      }
      // The transcript and the old summary stay; the owner can start the analysis again.
      await this.prisma.meetingFile.updateMany({
        where: running,
        data: { analysisStatus: 'FAILED' },
      });
    }
  }
}

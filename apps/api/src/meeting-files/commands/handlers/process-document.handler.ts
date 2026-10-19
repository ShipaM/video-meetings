import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { DocumentTextError, extractDocumentText } from '../../processing/document-text.js';
import { FAILURE_REASONS, documentJobTimeoutMs } from '../../processing/processing.config.js';
import { Summarizer, SummaryError } from '../../processing/summarizer.js';
import { ProcessDocumentCommand } from '../process-document.command.js';

@CommandHandler(ProcessDocumentCommand)
export class ProcessDocumentHandler implements ICommandHandler<ProcessDocumentCommand> {
  private readonly logger = new Logger(ProcessDocumentHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
    private readonly summarizer: Summarizer,
  ) {}

  async execute({ fileId, attempt, signal }: ProcessDocumentCommand): Promise<void> {
    // Every write below is conditional on this: the file is still PROCESSING for this attempt.
    const current = { id: fileId, status: 'PROCESSING' as const, processingAttempt: attempt };
    const file = await this.prisma.meetingFile.findFirst({ where: current });
    if (!file) {
      return; // deleted, or superseded by a newer attempt
    }

    const timeout = AbortSignal.timeout(documentJobTimeoutMs());
    const jobSignal = AbortSignal.any([signal, timeout]);
    try {
      const text = await extractDocumentText(
        this.storage.pathOf(file.storageKey),
        file.mimeType,
        jobSignal,
      );
      const summary = await this.summarizer.summarize(text, jobSignal);

      // Status and summary together: a file deleted meanwhile (0 rows) gets nothing back.
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.meetingFile.updateMany({
          where: current,
          data: { status: 'READY', failureReason: null },
        });
        if (count > 0) {
          await tx.meetingFileSummary.upsert({
            where: { fileId },
            create: { fileId, text: summary },
            update: { text: summary, createdAt: new Date() },
          });
        }
      });
    } catch (error) {
      if (signal.aborted && !timeout.aborted) {
        throw error; // shutdown or expiration: pg-boss retries the job
      }
      const reason = this.reasonFor(error, timeout);
      await this.prisma.meetingFile.updateMany({
        where: current,
        data: { status: 'FAILED', failureReason: reason },
      });
    }
  }

  private reasonFor(error: unknown, timeout: AbortSignal): string {
    if (timeout.aborted) {
      return FAILURE_REASONS.timeout;
    }
    if (error instanceof DocumentTextError) {
      return error.reason;
    }
    if (error instanceof SummaryError) {
      return FAILURE_REASONS.summary;
    }
    this.logger.error(`Processing failed unexpectedly: ${String(error)}`);
    return FAILURE_REASONS.unexpected;
  }
}

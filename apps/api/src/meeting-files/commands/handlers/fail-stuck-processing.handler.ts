import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ProcessingQueue } from '../../processing/processing-queue.js';
import { FAILURE_REASONS } from '../../processing/processing.config.js';
import { FailStuckProcessingCommand } from '../fail-stuck-processing.command.js';

@CommandHandler(FailStuckProcessingCommand)
export class FailStuckProcessingHandler implements ICommandHandler<FailStuckProcessingCommand> {
  private readonly logger = new Logger(FailStuckProcessingHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processing: ProcessingQueue,
  ) {}

  async execute({ cutoff }: FailStuckProcessingCommand): Promise<number> {
    const candidates = await this.prisma.meetingFile.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      select: { id: true, kind: true, processingAttempt: true },
    });

    let failed = 0;
    for (const { id, kind, processingAttempt } of candidates) {
      // Queued, running or waiting for a retry: not stuck, however long the queue is.
      if (await this.processing.hasLiveJob(kind, id, processingAttempt)) {
        continue;
      }
      // Conditional on the attempt: a retry started meanwhile is not touched.
      const { count } = await this.prisma.meetingFile.updateMany({
        where: { id, status: 'PROCESSING', processingAttempt },
        data: { status: 'FAILED', failureReason: FAILURE_REASONS.interrupted },
      });
      failed += count;
    }
    if (failed > 0) {
      this.logger.warn(`Failed ${failed} file(s) left PROCESSING without a job`);
    }
    return failed;
  }
}

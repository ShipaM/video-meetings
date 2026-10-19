import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { jobsPollingIntervalSeconds } from '../../jobs/jobs.config.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProcessDocumentCommand } from '../commands/process-document.command.js';
import { FAILURE_REASONS, documentJobTimeoutMs } from './processing.config.js';

export const PROCESS_DOCUMENT_QUEUE = 'process-document';

/** Payload of a document job: the file and the processing attempt it was sent for. */
export interface ProcessDocumentJob {
  fileId: string;
  attempt: number;
}

/**
 * The `process-document` queue: `start` sends a job, the worker hands each job to
 * `ProcessDocumentCommand`. The handler ends every expected failure in `FAILED` itself, so pg-boss
 * retries only a job that was interrupted (shutdown, crash, expiration); a newer attempt or a
 * deleted file turns a stale job into a no-op.
 */
@Injectable()
export class ProcessingQueue implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProcessingQueue.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.jobs;
    await boss.createQueue(PROCESS_DOCUMENT_QUEUE, {
      // The handler's own timeout fires first; this only frees a job whose worker died.
      expireInSeconds: Math.ceil(documentJobTimeoutMs() / 1000) + 60,
      retryLimit: 2,
      retryDelay: 30,
    });
    await boss.work<ProcessDocumentJob>(
      PROCESS_DOCUMENT_QUEUE,
      // One document at a time: a local model on the CPU gains nothing from parallel requests.
      { pollingIntervalSeconds: jobsPollingIntervalSeconds(), localConcurrency: 1 },
      async ([job]) => {
        await this.commandBus.execute(
          new ProcessDocumentCommand(job.data.fileId, job.data.attempt, job.signal),
        );
      },
    );
  }

  /**
   * Sends the job for a document just set to `PROCESSING` for `attempt`. If the job cannot be sent,
   * the file ends in `FAILED` at once (the owner can retry) instead of waiting for the watchdog.
   */
  async start(fileId: string, attempt: number): Promise<void> {
    const job: ProcessDocumentJob = { fileId, attempt };
    try {
      await this.jobs.boss.send(PROCESS_DOCUMENT_QUEUE, job);
    } catch (error) {
      this.logger.error(`Could not queue the processing of ${fileId}: ${String(error)}`);
      await this.prisma.meetingFile.updateMany({
        where: { id: fileId, status: 'PROCESSING', processingAttempt: attempt },
        data: { status: 'FAILED', failureReason: FAILURE_REASONS.notStarted },
      });
    }
  }
}

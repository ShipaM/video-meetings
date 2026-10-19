import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { Db } from 'pg-boss';
import type { Prisma } from '../../generated/prisma/client.js';
import { jobsPollingIntervalSeconds } from '../../jobs/jobs.config.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ProcessDocumentCommand } from '../commands/process-document.command.js';
import { documentJobTimeoutMs } from './processing.config.js';

export const PROCESS_DOCUMENT_QUEUE = 'process-document';

/** Payload of a document job: the file and the processing attempt it was sent for. */
export interface ProcessDocumentJob {
  fileId: string;
  attempt: number;
}

/** Job states in which a job will still run (or is running). */
const LIVE_STATES = new Set(['created', 'retry', 'active']);

/** Lets pg-boss write its job through a Prisma transaction, so it commits with the status. */
const transactionDb = (tx: Prisma.TransactionClient): Db => ({
  executeSql: async (text, values = []) => ({ rows: await tx.$queryRawUnsafe(text, ...values) }),
});

/**
 * The `process-document` queue: `queue` adds a job inside the transaction that sets the file to
 * `PROCESSING`, the worker hands each job to `ProcessDocumentCommand`. The handler ends every
 * expected failure in `FAILED` itself, so pg-boss retries only a job that was interrupted
 * (shutdown, crash, expiration); a newer attempt or a deleted file turns a stale job into a no-op.
 */
@Injectable()
export class ProcessingQueue implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly commandBus: CommandBus,
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
   * Adds the job for `attempt` of a document within `tx`, the transaction that sets the file to
   * `PROCESSING`: both commit, or neither does (no file waits for a job that was never sent).
   */
  async queue(tx: Prisma.TransactionClient, fileId: string, attempt: number): Promise<void> {
    const job: ProcessDocumentJob = { fileId, attempt };
    await this.jobs.boss.send(PROCESS_DOCUMENT_QUEUE, job, { db: transactionDb(tx) });
  }

  /** Whether a job for `attempt` of the file is still queued, running or waiting for a retry. */
  async hasLiveJob(fileId: string, attempt: number): Promise<boolean> {
    const jobs = await this.jobs.boss.findJobs<ProcessDocumentJob>(PROCESS_DOCUMENT_QUEUE, {
      data: { fileId, attempt },
    });
    return jobs.some((job) => LIVE_STATES.has(job.state));
  }
}

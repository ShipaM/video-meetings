import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { Db } from 'pg-boss';
import type { Prisma } from '../../generated/prisma/client.js';
import type { MeetingFileKind } from '../../generated/prisma/enums.js';
import { jobsPollingIntervalSeconds } from '../../jobs/jobs.config.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ProcessDocumentCommand } from '../commands/process-document.command.js';
import { ProcessRecordingCommand } from '../commands/process-recording.command.js';
import { documentJobTimeoutMs, recordingJobExpirationSeconds } from './processing.config.js';

export const PROCESS_DOCUMENT_QUEUE = 'process-document';
export const PROCESS_RECORDING_QUEUE = 'process-recording';

/** Kinds that are processed in the background; any other kind is `READY` once uploaded. */
export const PROCESSED_KINDS: readonly MeetingFileKind[] = ['DOCUMENT', 'AUDIO', 'VIDEO'];

/** Payload of a processing job: the file and the processing attempt it was sent for. */
export interface ProcessFileJob {
  fileId: string;
  attempt: number;
}

/** Job states in which a job will still run (or is running). */
const LIVE_STATES = new Set(['created', 'retry', 'active']);

const QUEUES = [PROCESS_DOCUMENT_QUEUE, PROCESS_RECORDING_QUEUE];

const queueOf = (kind: MeetingFileKind): string =>
  kind === 'DOCUMENT' ? PROCESS_DOCUMENT_QUEUE : PROCESS_RECORDING_QUEUE;

/** Lets pg-boss write its job through a Prisma transaction, so it commits with the status. */
const transactionDb = (tx: Prisma.TransactionClient): Db => ({
  executeSql: async (text, values = []) => ({ rows: await tx.$queryRawUnsafe(text, ...values) }),
});

/**
 * The processing queues: `process-document` (summaries) and `process-recording` (transcripts and
 * summaries). `queue` adds a job inside the transaction that sets the file to `PROCESSING`, the
 * workers hand each job to its command. The handlers end every expected failure in `FAILED`
 * themselves, so pg-boss retries only a job that was interrupted (shutdown, crash, expiration); a
 * newer attempt or a deleted file turns a stale job into a no-op.
 */
@Injectable()
export class ProcessingQueue implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly commandBus: CommandBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.jobs;
    const pollingIntervalSeconds = jobsPollingIntervalSeconds();
    // The handlers' own timeouts fire first; expiration only frees a job whose worker died.
    await boss.createQueue(PROCESS_DOCUMENT_QUEUE, {
      expireInSeconds: Math.ceil(documentJobTimeoutMs() / 1000) + 60,
      retryLimit: 2,
      retryDelay: 30,
    });
    await boss.createQueue(PROCESS_RECORDING_QUEUE, {
      expireInSeconds: recordingJobExpirationSeconds(),
      retryLimit: 2,
      retryDelay: 30,
    });
    // One job at a time per queue: a local model on the CPU gains nothing from parallel requests.
    // A document is not stuck behind an hours-long recording, though.
    await boss.work<ProcessFileJob>(
      PROCESS_DOCUMENT_QUEUE,
      { pollingIntervalSeconds, localConcurrency: 1 },
      async ([job]) => {
        await this.commandBus.execute(
          new ProcessDocumentCommand(job.data.fileId, job.data.attempt, job.signal),
        );
      },
    );
    await boss.work<ProcessFileJob>(
      PROCESS_RECORDING_QUEUE,
      { pollingIntervalSeconds, localConcurrency: 1 },
      async ([job]) => {
        await this.commandBus.execute(
          new ProcessRecordingCommand(job.data.fileId, job.data.attempt, job.signal),
        );
      },
    );
  }

  /**
   * Adds the job for `attempt` of a file of a `PROCESSED_KINDS` kind within `tx`, the transaction
   * that sets the file to `PROCESSING`: both commit, or neither does (no file waits for a job that
   * was never sent).
   */
  async queue(
    tx: Prisma.TransactionClient,
    kind: MeetingFileKind,
    fileId: string,
    attempt: number,
  ): Promise<void> {
    const job: ProcessFileJob = { fileId, attempt };
    const queue = queueOf(kind);
    await this.jobs.boss.send(queue, job, {
      db: transactionDb(tx),
      // From the limit at the time of sending: a changed MAX_RECORDING_MINUTES applies at once.
      ...(queue === PROCESS_RECORDING_QUEUE && {
        expireInSeconds: recordingJobExpirationSeconds(),
      }),
    });
  }

  /** Whether a job for `attempt` of the file is still queued, running or waiting for a retry. */
  async hasLiveJob(fileId: string, attempt: number): Promise<boolean> {
    for (const queue of QUEUES) {
      const jobs = await this.jobs.boss.findJobs<ProcessFileJob>(queue, {
        data: { fileId, attempt },
      });
      if (jobs.some((job) => LIVE_STATES.has(job.state))) {
        return true;
      }
    }
    return false;
  }
}

import { Command } from '@nestjs/cqrs';

/**
 * A background job: extracts the text of a `PROCESSING` document and stores its summary (`READY`),
 * or ends in `FAILED` with a reason. Does nothing when the file is gone or `attempt` is stale.
 * Rejects only when `signal` (pg-boss: shutdown or expiration) is aborted, so the job is retried.
 */
export class ProcessDocumentCommand extends Command<void> {
  constructor(
    public readonly fileId: string,
    public readonly attempt: number,
    public readonly signal: AbortSignal,
  ) {
    super();
  }
}

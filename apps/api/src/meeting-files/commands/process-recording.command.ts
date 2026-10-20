import { Command } from '@nestjs/cqrs';

/**
 * A background job: transcribes a `PROCESSING` recording (audio or video) and summarizes the
 * transcript (`READY` with both), or ends in `FAILED` with a reason. Does nothing when the file is
 * gone or `attempt` is stale. Rejects only when `signal` (pg-boss: shutdown or expiration) is
 * aborted, so the job is retried.
 */
export class ProcessRecordingCommand extends Command<void> {
  constructor(
    public readonly fileId: string,
    public readonly attempt: number,
    public readonly signal: AbortSignal,
  ) {
    super();
  }
}

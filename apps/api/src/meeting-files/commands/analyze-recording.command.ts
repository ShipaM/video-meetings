import { Command } from '@nestjs/cqrs';

/**
 * A background job: analyzes the stored transcript of a `READY` recording whose analysis is
 * `RUNNING`, then stores the insights, removes the older summary and clears `analysisStatus`; or
 * sets it to `FAILED`, keeping the transcript and the older summary. The file stays `READY`. Does
 * nothing when the file is gone or no analysis is running. Rejects only when `signal` (pg-boss:
 * shutdown or expiration) is aborted, so the job is retried.
 */
export class AnalyzeRecordingCommand extends Command<void> {
  constructor(
    public readonly fileId: string,
    public readonly signal: AbortSignal,
  ) {
    super();
  }
}

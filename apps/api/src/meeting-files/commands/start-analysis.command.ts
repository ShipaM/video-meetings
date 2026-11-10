import { Command } from '@nestjs/cqrs';
import type { MeetingFileDetails } from '../meeting-files.types.js';

/**
 * The owner starts the analysis of a `READY` recording that has a transcript but no insights;
 * resolves to the file, still `READY`, with `analysisStatus` `RUNNING`.
 */
export class StartAnalysisCommand extends Command<MeetingFileDetails> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

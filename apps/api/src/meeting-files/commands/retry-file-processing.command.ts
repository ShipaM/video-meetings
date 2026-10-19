import { Command } from '@nestjs/cqrs';
import type { MeetingFileDetails } from '../meeting-files.types.js';

/** The owner processes a `FAILED` document again; resolves to the file, now `PROCESSING`. */
export class RetryFileProcessingCommand extends Command<MeetingFileDetails> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

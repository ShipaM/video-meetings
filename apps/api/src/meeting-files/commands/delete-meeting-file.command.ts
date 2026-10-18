import { Command } from '@nestjs/cqrs';

/** The owner deletes a completed file of their meeting: the record and the stored original. */
export class DeleteMeetingFileCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

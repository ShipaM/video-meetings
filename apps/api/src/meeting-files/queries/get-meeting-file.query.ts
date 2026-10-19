import { Query } from '@nestjs/cqrs';
import type { MeetingFileDetails } from '../meeting-files.types.js';

/** A completed file of a meeting with its processing result, for the owner or a participant. */
export class GetMeetingFileQuery extends Query<MeetingFileDetails> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

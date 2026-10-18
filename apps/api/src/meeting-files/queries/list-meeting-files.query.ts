import { Query } from '@nestjs/cqrs';
import type { MeetingFileView } from '../meeting-files.types.js';

/** Completed files of a meeting the user owns. */
export class ListMeetingFilesQuery extends Query<MeetingFileView[]> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
  ) {
    super();
  }
}

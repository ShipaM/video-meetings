import { Query } from '@nestjs/cqrs';
import type { MeetingFileListItem } from '../meeting-files.types.js';

/** Completed files of a meeting the user can view, with their summaries. */
export class ListMeetingFilesQuery extends Query<MeetingFileListItem[]> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
  ) {
    super();
  }
}

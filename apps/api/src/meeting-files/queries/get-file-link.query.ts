import { Query } from '@nestjs/cqrs';
import type { FileLink } from '../meeting-files.types.js';

/** Issues a short-lived signed download link for a completed file of the user's meeting. */
export class GetFileLinkQuery extends Query<FileLink> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

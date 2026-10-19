import { Query } from '@nestjs/cqrs';
import type { ParticipantView } from '../meetings.types.js';

/** Participants of a meeting, oldest first; owner only. */
export class ListParticipantsQuery extends Query<ParticipantView[]> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
  ) {
    super();
  }
}

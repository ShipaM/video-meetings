import { Query } from '@nestjs/cqrs';
import type { MeetingView } from '../meetings.types.js';

/** Meetings the user owns or participates in, each with the user's role. */
export class ListMeetingsQuery extends Query<MeetingView[]> {
  constructor(public readonly userId: string) {
    super();
  }
}

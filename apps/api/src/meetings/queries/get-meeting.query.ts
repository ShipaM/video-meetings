import { Query } from '@nestjs/cqrs';
import type { MeetingAccess, MeetingView } from '../meetings.types.js';

/**
 * Loads a meeting for `userId`: `404` when the user is neither its owner nor a participant,
 * `403` when a participant asks for `manage` access.
 */
export class GetMeetingQuery extends Query<MeetingView> {
  constructor(
    public readonly userId: string,
    public readonly id: string,
    public readonly access: MeetingAccess = 'view',
  ) {
    super();
  }
}

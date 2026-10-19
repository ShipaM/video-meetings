import { Command } from '@nestjs/cqrs';
import type { ParticipantView } from '../meetings.types.js';

/** Shares a meeting with the registered user who has `email`; owner only. */
export class AddParticipantCommand extends Command<ParticipantView> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly email: string,
  ) {
    super();
  }
}

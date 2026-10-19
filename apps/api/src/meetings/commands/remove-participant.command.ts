import { Command } from '@nestjs/cqrs';

/** Takes a participant's access to a meeting away; owner only. */
export class RemoveParticipantCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
    public readonly participantId: string,
  ) {
    super();
  }
}

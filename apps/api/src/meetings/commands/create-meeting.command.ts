import { Command } from '@nestjs/cqrs';
import type { MeetingView } from '../meetings.types.js';

export class CreateMeetingCommand extends Command<MeetingView> {
  constructor(
    public readonly ownerId: string,
    public readonly title: string,
    public readonly startsAt: Date,
  ) {
    super();
  }
}

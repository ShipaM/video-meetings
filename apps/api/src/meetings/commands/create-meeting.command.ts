import { Command } from '@nestjs/cqrs';
import type { Meeting } from '../../generated/prisma/client.js';

export class CreateMeetingCommand extends Command<Meeting> {
  constructor(
    public readonly ownerId: string,
    public readonly title: string,
    public readonly startsAt: Date,
  ) {
    super();
  }
}

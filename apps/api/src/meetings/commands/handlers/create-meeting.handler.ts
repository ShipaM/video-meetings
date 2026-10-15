import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { Meeting } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CreateMeetingCommand } from '../create-meeting.command.js';

@CommandHandler(CreateMeetingCommand)
export class CreateMeetingHandler implements ICommandHandler<CreateMeetingCommand> {
  constructor(private readonly prisma: PrismaService) {}

  execute({ ownerId, title, startsAt }: CreateMeetingCommand): Promise<Meeting> {
    return this.prisma.meeting.create({ data: { ownerId, title, startsAt } });
  }
}

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingView, toMeetingView } from '../../meetings.types.js';
import { CreateMeetingCommand } from '../create-meeting.command.js';

@CommandHandler(CreateMeetingCommand)
export class CreateMeetingHandler implements ICommandHandler<CreateMeetingCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId, title, startsAt }: CreateMeetingCommand): Promise<MeetingView> {
    const meeting = await this.prisma.meeting.create({ data: { ownerId, title, startsAt } });
    return toMeetingView(meeting, ownerId);
  }
}

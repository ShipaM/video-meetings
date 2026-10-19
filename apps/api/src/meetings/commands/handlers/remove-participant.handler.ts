import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { GetMeetingQuery } from '../../queries/get-meeting.query.js';
import { RemoveParticipantCommand } from '../remove-participant.command.js';

@CommandHandler(RemoveParticipantCommand)
export class RemoveParticipantHandler implements ICommandHandler<RemoveParticipantCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, meetingId, participantId }: RemoveParticipantCommand): Promise<void> {
    // 404 for a stranger, 403 for a participant.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

    // Access is checked against this row on every request, so it ends right here; links issued
    // earlier stop working too.
    const { count } = await this.prisma.meetingParticipant.deleteMany({
      where: { meetingId, userId: participantId },
    });
    if (count === 0) {
      throw new NotFoundException('Participant not found');
    }
  }
}

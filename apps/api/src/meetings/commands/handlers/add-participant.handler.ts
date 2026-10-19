import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUserByEmailQuery } from '../../../users/index.js';
import type { ParticipantView } from '../../meetings.types.js';
import { GetMeetingQuery } from '../../queries/get-meeting.query.js';
import { AddParticipantCommand } from '../add-participant.command.js';

@CommandHandler(AddParticipantCommand)
export class AddParticipantHandler implements ICommandHandler<AddParticipantCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, meetingId, email }: AddParticipantCommand): Promise<ParticipantView> {
    // 404 for a stranger, 403 for a participant.
    const meeting = await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

    const user = await this.queryBus.execute(new FindUserByEmailQuery(email));
    if (!user) {
      throw new NotFoundException('No registered user has this e-mail');
    }
    if (user.id === meeting.ownerId) {
      throw new BadRequestException('The owner cannot be added as a participant');
    }

    try {
      const { addedAt } = await this.prisma.meetingParticipant.create({
        data: { meetingId, userId: user.id },
      });
      return { userId: user.id, email: user.email, addedAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // The (meetingId, userId) primary key also settles two concurrent adds.
        if (error.code === 'P2002') {
          throw new ConflictException('This user is already a participant');
        }
        // A foreign key: the meeting or the user was deleted since they were read.
        if (error.code === 'P2003') {
          throw new NotFoundException('Meeting or user not found');
        }
      }
      throw error;
    }
  }
}

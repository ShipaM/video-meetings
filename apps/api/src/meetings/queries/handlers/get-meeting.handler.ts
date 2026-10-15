import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { Meeting } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { GetMeetingQuery } from '../get-meeting.query.js';

@QueryHandler(GetMeetingQuery)
export class GetMeetingHandler implements IQueryHandler<GetMeetingQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId, id }: GetMeetingQuery): Promise<Meeting> {
    // Filtering by owner makes another user's meeting indistinguishable from a missing one.
    const meeting = await this.prisma.meeting.findFirst({ where: { id, ownerId } });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }
    return meeting;
  }
}

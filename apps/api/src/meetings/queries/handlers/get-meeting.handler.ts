import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingView, toMeetingView, visibleTo } from '../../meetings.types.js';
import { GetMeetingQuery } from '../get-meeting.query.js';

@QueryHandler(GetMeetingQuery)
export class GetMeetingHandler implements IQueryHandler<GetMeetingQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, id, access }: GetMeetingQuery): Promise<MeetingView> {
    // Filtering by owner or participant makes a meeting of anybody else indistinguishable from a
    // missing one.
    const meeting = await this.prisma.meeting.findFirst({ where: { id, ...visibleTo(userId) } });
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    const view = toMeetingView(meeting, userId);
    if (access === 'manage' && view.role !== 'owner') {
      throw new ForbiddenException('Only the meeting owner can do this');
    }
    return view;
  }
}

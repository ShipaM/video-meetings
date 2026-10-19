import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingView, toMeetingView, visibleTo } from '../../meetings.types.js';
import { ListMeetingsQuery } from '../list-meetings.query.js';

@QueryHandler(ListMeetingsQuery)
export class ListMeetingsHandler implements IQueryHandler<ListMeetingsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId }: ListMeetingsQuery): Promise<MeetingView[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: visibleTo(userId),
      orderBy: { startsAt: 'asc' },
    });
    return meetings.map((meeting) => toMeetingView(meeting, userId));
  }
}

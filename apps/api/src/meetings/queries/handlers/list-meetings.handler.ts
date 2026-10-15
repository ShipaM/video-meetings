import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { Meeting } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ListMeetingsQuery } from '../list-meetings.query.js';

@QueryHandler(ListMeetingsQuery)
export class ListMeetingsHandler implements IQueryHandler<ListMeetingsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute({ ownerId }: ListMeetingsQuery): Promise<Meeting[]> {
    return this.prisma.meeting.findMany({ where: { ownerId }, orderBy: { startsAt: 'asc' } });
  }
}

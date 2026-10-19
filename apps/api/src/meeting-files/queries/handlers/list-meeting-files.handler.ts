import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingFileView, toMeetingFileView } from '../../meeting-files.types.js';
import { ListMeetingFilesQuery } from '../list-meeting-files.query.js';

@QueryHandler(ListMeetingFilesQuery)
export class ListMeetingFilesHandler implements IQueryHandler<ListMeetingFilesQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, meetingId }: ListMeetingFilesQuery): Promise<MeetingFileView[]> {
    // The owner and participants: 404 for anybody else.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId));

    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId, status: { not: 'UPLOADING' } },
      orderBy: { createdAt: 'desc' },
    });
    return files.map(toMeetingFileView);
  }
}

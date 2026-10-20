import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingFileDetails, toMeetingFileDetails } from '../../meeting-files.types.js';
import { ListMeetingFilesQuery } from '../list-meeting-files.query.js';

@QueryHandler(ListMeetingFilesQuery)
export class ListMeetingFilesHandler implements IQueryHandler<ListMeetingFilesQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, meetingId }: ListMeetingFilesQuery): Promise<MeetingFileDetails[]> {
    // The owner and participants: 404 for anybody else.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId));

    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId, status: { not: 'UPLOADING' } },
      orderBy: { createdAt: 'desc' },
      // Summaries come with the list, so a page polling it sees them as soon as files are READY.
      include: { summary: true },
    });
    return files.map(toMeetingFileDetails);
  }
}

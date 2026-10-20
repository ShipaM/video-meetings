import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { type MeetingFileDetails, toMeetingFileDetails } from '../../meeting-files.types.js';
import { GetMeetingFileQuery } from '../get-meeting-file.query.js';

@QueryHandler(GetMeetingFileQuery)
export class GetMeetingFileHandler implements IQueryHandler<GetMeetingFileQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, meetingId, fileId }: GetMeetingFileQuery): Promise<MeetingFileDetails> {
    // The owner and participants: 404 for anybody else.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId));

    // An upload in progress is not a file yet, as in the list.
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, status: { not: 'UPLOADING' } },
      include: { summary: true, transcript: { orderBy: { position: 'asc' } } },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }
    return toMeetingFileDetails(file);
  }
}

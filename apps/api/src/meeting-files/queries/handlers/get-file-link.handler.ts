import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { fileLinkSecret } from '../../../storage/storage.config.js';
import { isRecording } from '../../file-types.js';
import {
  FILE_LINK_AUDIENCE,
  FILE_LINK_TTL_SECONDS,
  mediaLinkTtlSeconds,
} from '../../meeting-files.config.js';
import type { FileLink, FileLinkPayload } from '../../meeting-files.types.js';
import { GetFileLinkQuery } from '../get-file-link.query.js';

@QueryHandler(GetFileLinkQuery)
export class GetFileLinkHandler implements IQueryHandler<GetFileLinkQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly jwt: JwtService,
  ) {}

  async execute({ userId, meetingId, fileId }: GetFileLinkQuery): Promise<FileLink> {
    // The owner and participants: 404 for anybody else.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId));

    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, meetingId, status: { not: 'UPLOADING' } },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    // A recording is played and seeks long after the link was issued.
    const ttlSeconds = isRecording(file.kind)
      ? mediaLinkTtlSeconds(file.durationMs)
      : FILE_LINK_TTL_SECONDS;
    const payload: FileLinkPayload = { sub: userId, fileId };
    const token = await this.jwt.signAsync(payload, {
      secret: fileLinkSecret(),
      audience: FILE_LINK_AUDIENCE,
      expiresIn: ttlSeconds,
    });
    return {
      url: `/files/${fileId}/content?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }
}

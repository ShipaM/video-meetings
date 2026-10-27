import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { GetMeetingQuery } from '../../../meetings/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { FILE_LINK_AUDIENCE, fileLinkSecret } from '../../meeting-files.config.js';
import type { FileContent, FileLinkPayload } from '../../meeting-files.types.js';
import { GetFileContentQuery } from '../get-file-content.query.js';

@QueryHandler(GetFileContentQuery)
export class GetFileContentHandler implements IQueryHandler<GetFileContentQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
    private readonly jwt: JwtService,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ fileId, token }: GetFileContentQuery): Promise<FileContent> {
    const payload = await this.verify(token);
    if (payload?.fileId !== fileId) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    // The token only proves who asked; access is checked again, so a deleted file or a lost
    // permission stops working even before the link expires.
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, status: { not: 'UPLOADING' } },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }
    await this.queryBus.execute(new GetMeetingQuery(payload.sub, file.meetingId));

    return {
      path: this.storage.pathOf(file.storageKey),
      originalName: file.originalName,
      mimeType: file.mimeType,
    };
  }

  private async verify(token: string | undefined): Promise<FileLinkPayload | null> {
    if (!token) {
      return null;
    }
    try {
      return await this.jwt.verifyAsync<FileLinkPayload>(token, {
        secret: fileLinkSecret(),
        audience: FILE_LINK_AUDIENCE,
      });
    } catch {
      return null;
    }
  }
}

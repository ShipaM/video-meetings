import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { MeetingFile } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { GetUploadQuery } from '../get-upload.query.js';

@QueryHandler(GetUploadQuery)
export class GetUploadHandler implements IQueryHandler<GetUploadQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, fileId }: GetUploadQuery): Promise<MeetingFile> {
    // Only the uploader may continue an upload; anyone else cannot tell it exists.
    const file = await this.prisma.meetingFile.findFirst({
      where: { id: fileId, uploadedById: userId },
    });
    if (!file) {
      throw new NotFoundException('Upload not found');
    }
    return file;
  }
}

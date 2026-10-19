import { NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../meetings/index.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Called when `fileId` is not an upload of `userId`. A participant of its meeting may know the
 * meeting but not write to it (`403`); everybody else cannot tell the upload exists (`404`).
 */
export async function rejectForeignUpload(
  prisma: PrismaService,
  queryBus: QueryBus,
  userId: string,
  fileId: string,
): Promise<never> {
  const file = await prisma.meetingFile.findUnique({
    where: { id: fileId },
    select: { meetingId: true },
  });
  if (file) {
    // Throws 404 for a stranger and 403 for a participant.
    await queryBus.execute(new GetMeetingQuery(userId, file.meetingId, 'manage'));
  }
  throw new NotFoundException('Upload not found');
}

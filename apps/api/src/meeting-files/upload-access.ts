import { NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import type { MeetingFile } from '../generated/prisma/client.js';
import { GetMeetingQuery } from '../meetings/index.js';

/**
 * Only the uploader may continue or cancel an upload. For anyone else the meeting rules decide
 * from the row already read (no second lookup): a participant gets `403`, everybody else `404`,
 * as for a missing upload. Resolves to the file for its uploader.
 */
export async function requireOwnUpload<T extends Pick<MeetingFile, 'uploadedById' | 'meetingId'>>(
  queryBus: QueryBus,
  userId: string,
  file: T | null,
): Promise<T> {
  if (file?.uploadedById === userId) {
    return file;
  }
  if (file) {
    // Throws 404 for a stranger and 403 for a participant.
    await queryBus.execute(new GetMeetingQuery(userId, file.meetingId, 'manage'));
  }
  throw new NotFoundException('Upload not found');
}

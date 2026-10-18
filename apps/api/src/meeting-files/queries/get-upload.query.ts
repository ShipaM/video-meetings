import { Query } from '@nestjs/cqrs';
import type { MeetingFile } from '../../generated/prisma/client.js';

/** An upload of the given user, for tus `HEAD` / `PATCH` requests. */
export class GetUploadQuery extends Query<MeetingFile> {
  constructor(
    public readonly userId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

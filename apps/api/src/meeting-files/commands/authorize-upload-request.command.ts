import { Command } from '@nestjs/cqrs';
import type { MeetingFile } from '../../generated/prisma/client.js';

/**
 * Runs before tus handles `HEAD` / `PATCH` on an existing upload: checks that it is the caller's,
 * records chunk activity and finishes an upload whose completion failed earlier.
 */
export class AuthorizeUploadRequestCommand extends Command<MeetingFile> {
  constructor(
    public readonly userId: string,
    public readonly fileId: string,
    public readonly method: string,
  ) {
    super();
  }
}

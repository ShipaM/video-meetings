import { Command } from '@nestjs/cqrs';
import type { MeetingFile } from '../../generated/prisma/client.js';

/** Called once the last byte of an upload is stored: verifies the content and finalises the file. */
export class CompleteUploadCommand extends Command<MeetingFile> {
  constructor(public readonly fileId: string) {
    super();
  }
}

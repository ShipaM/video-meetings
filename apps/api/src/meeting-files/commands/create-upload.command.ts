import { Command } from '@nestjs/cqrs';
import type { MeetingFile } from '../../generated/prisma/client.js';

/** Registers a new tus upload as an `UPLOADING` meeting file. */
export class CreateUploadCommand extends Command<MeetingFile> {
  constructor(
    public readonly userId: string,
    public readonly uploadId: string,
    public readonly size: number,
    /** Decoded tus `Upload-Metadata`: `meetingId`, `filename`, `filetype`. */
    public readonly metadata: Record<string, string | null>,
  ) {
    super();
  }
}

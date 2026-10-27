import { Command } from '@nestjs/cqrs';

/**
 * Registers a new tus upload as an `UPLOADING` avatar of the user. Fails with `400` for a type
 * outside PNG / JPEG / WebP and `413` over 5 MB, before any data is stored.
 */
export class CreateAvatarUploadCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly uploadId: string,
    public readonly size: number,
    /** Decoded tus `Upload-Metadata`: `filename`, `filetype` (and `purpose`, not used here). */
    public readonly metadata: Record<string, string | null>,
  ) {
    super();
  }
}

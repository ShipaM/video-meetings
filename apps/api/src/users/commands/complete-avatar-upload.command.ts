import { Command } from '@nestjs/cqrs';

/**
 * Finishes an avatar upload once tus has all its bytes: checks the magic bytes against the stored
 * type and makes it `READY`; on a mismatch removes the row and the data and fails with `400`.
 */
export class CompleteAvatarUploadCommand extends Command<void> {
  constructor(public readonly uploadId: string) {
    super();
  }
}

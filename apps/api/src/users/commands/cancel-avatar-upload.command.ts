import { Command } from '@nestjs/cqrs';

/**
 * Cancels the user's own avatar upload in progress (tus termination) by deleting its row; tus
 * removes the data afterwards. `404` for a missing or foreign upload, `409` once it is complete.
 */
export class CancelAvatarUploadCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly uploadId: string,
  ) {
    super();
  }
}

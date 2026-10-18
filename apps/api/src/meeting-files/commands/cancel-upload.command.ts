import { Command } from '@nestjs/cqrs';

/**
 * Runs before tus handles `DELETE /uploads/:id` (termination): removes the caller's `UPLOADING`
 * row; tus then removes the partial data.
 */
export class CancelUploadCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}

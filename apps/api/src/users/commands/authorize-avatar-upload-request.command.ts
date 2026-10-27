import { Command } from '@nestjs/cqrs';

/**
 * Runs before tus handles `HEAD` / `PATCH` on an existing avatar upload: checks that it is the
 * caller's (`404` otherwise), records chunk activity and finishes an upload whose completion failed
 * earlier.
 */
export class AuthorizeAvatarUploadRequestCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly uploadId: string,
    public readonly method: string,
  ) {
    super();
  }
}

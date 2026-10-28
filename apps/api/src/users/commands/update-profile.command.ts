import { Command } from '@nestjs/cqrs';
import type { UserProfile } from '../users.types.js';

/**
 * Updates the profile of a user and returns it. The name is trimmed; an empty one (or `null`) clears it, and an
 * omitted one stays as it is. `avatarUploadId` attaches the user's own `READY` avatar upload, `null` removes the
 * avatar, omitted keeps it; a replaced or removed avatar is deleted (row, then data). Fails with
 * `NotFoundException` when there is no such user or the upload is missing or another user's, and with
 * `ConflictException` when the upload is not complete.
 */
export class UpdateProfileCommand extends Command<UserProfile> {
  constructor(
    public readonly userId: string,
    public readonly name?: string | null,
    public readonly avatarUploadId?: string | null,
  ) {
    super();
  }
}

import { Command } from '@nestjs/cqrs';
import type { UserProfile } from '../users.types.js';

/**
 * Updates the profile of a user and returns it. The name is trimmed; an empty one (or `null`) clears it, and an
 * omitted one stays as it is. Fails with `NotFoundException` when there is no such user.
 */
export class UpdateProfileCommand extends Command<UserProfile> {
  constructor(
    public readonly userId: string,
    public readonly name?: string | null,
  ) {
    super();
  }
}

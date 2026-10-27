import { Command } from '@nestjs/cqrs';

/**
 * Replaces the password hash of a user; the caller hashes the password. Fails with `NotFoundException` when there is
 * no such user.
 */
export class UpdatePasswordHashCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly passwordHash: string,
  ) {
    super();
  }
}

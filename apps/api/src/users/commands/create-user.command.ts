import { Command } from '@nestjs/cqrs';
import type { UserRecord } from '../users.types.js';

/** Creates a user. Fails with `ConflictException` when the e-mail is already taken. */
export class CreateUserCommand extends Command<UserRecord> {
  constructor(
    public readonly email: string,
    public readonly passwordHash: string,
  ) {
    super();
  }
}

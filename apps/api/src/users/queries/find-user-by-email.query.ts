import { Query } from '@nestjs/cqrs';
import type { UserRecord } from '../users.types.js';

/** Looks a user up by e-mail (case-insensitive). Resolves to `null` when there is none. */
export class FindUserByEmailQuery extends Query<UserRecord | null> {
  constructor(public readonly email: string) {
    super();
  }
}

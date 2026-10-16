import { Query } from '@nestjs/cqrs';
import type { UserRecord } from '../users.types.js';

/** Looks a user up by id. Resolves to `null` when there is none. */
export class FindUserByIdQuery extends Query<UserRecord | null> {
  constructor(public readonly id: string) {
    super();
  }
}

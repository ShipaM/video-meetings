import { Query } from '@nestjs/cqrs';
import type { UserProfile } from '../users.types.js';

/** Reads the profile of a user. Fails with `NotFoundException` when there is none. */
export class GetProfileQuery extends Query<UserProfile> {
  constructor(public readonly userId: string) {
    super();
  }
}

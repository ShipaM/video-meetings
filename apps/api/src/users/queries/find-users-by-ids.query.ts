import { Query } from '@nestjs/cqrs';
import type { UserContact } from '../users.types.js';

/**
 * Looks several users up by id in one query; only `id` and `email`, never the password hash.
 * Unknown ids are left out of the result.
 */
export class FindUsersByIdsQuery extends Query<UserContact[]> {
  constructor(public readonly ids: string[]) {
    super();
  }
}

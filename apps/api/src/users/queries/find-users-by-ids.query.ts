import { Query } from '@nestjs/cqrs';
import type { UserRecord } from '../users.types.js';

/** Looks several users up by id in one query. Unknown ids are left out of the result. */
export class FindUsersByIdsQuery extends Query<UserRecord[]> {
  constructor(public readonly ids: string[]) {
    super();
  }
}

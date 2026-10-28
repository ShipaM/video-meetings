import { Query } from '@nestjs/cqrs';

/**
 * Of the given storage keys, the ones that belong to an avatar upload (any status), in one query.
 * The orphan file sweep keeps their data.
 */
export class FindAvatarStorageKeysQuery extends Query<string[]> {
  constructor(public readonly keys: string[]) {
    super();
  }
}

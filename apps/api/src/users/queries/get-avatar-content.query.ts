import { Query } from '@nestjs/cqrs';
import type { AvatarContent } from '../users.types.js';

/** Resolves a signed avatar link to the stored image, re-checking that it is still the avatar. */
export class GetAvatarContentQuery extends Query<AvatarContent> {
  constructor(
    public readonly avatarId: string,
    public readonly token: string | undefined,
  ) {
    super();
  }
}

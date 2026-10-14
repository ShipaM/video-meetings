import { Query } from '@nestjs/cqrs';
import type { AccessTokenResult } from '../auth.types.js';

export class LoginQuery extends Query<AccessTokenResult> {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {
    super();
  }
}

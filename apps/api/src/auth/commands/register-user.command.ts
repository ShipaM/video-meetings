import { Command } from '@nestjs/cqrs';
import type { AccessTokenResult } from '../auth.types.js';

export class RegisterUserCommand extends Command<AccessTokenResult> {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {
    super();
  }
}

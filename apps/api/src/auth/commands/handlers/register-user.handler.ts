import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { hash } from 'bcryptjs';
import { CreateUserCommand } from '../../../users/index.js';
import { BCRYPT_ROUNDS } from '../../auth.constants.js';
import type { AccessTokenResult } from '../../auth.types.js';
import { TokenService } from '../../token.service.js';
import { RegisterUserCommand } from '../register-user.command.js';

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password }: RegisterUserCommand): Promise<AccessTokenResult> {
    const passwordHash = await hash(password, BCRYPT_ROUNDS);
    const user = await this.commandBus.execute(new CreateUserCommand(email, passwordHash));

    return this.tokens.issue(user.id, user.email);
  }
}

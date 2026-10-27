import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { compare, hash } from 'bcryptjs';
import { FindUserByIdQuery, UpdatePasswordHashCommand } from '../../../users/index.js';
import { BCRYPT_ROUNDS } from '../../auth.constants.js';
import { ChangePasswordCommand } from '../change-password.command.js';

@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<ChangePasswordCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, oldPassword, newPassword }: ChangePasswordCommand): Promise<void> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(userId));
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 403, not 401: the token is valid, and a 401 would sign the user out in the web app.
    if (!(await compare(oldPassword, user.passwordHash))) {
      throw new ForbiddenException('Wrong current password');
    }

    const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
    await this.commandBus.execute(new UpdatePasswordHashCommand(userId, passwordHash));
  }
}

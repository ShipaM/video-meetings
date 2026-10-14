import { ConflictException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { hash } from 'bcryptjs';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { BCRYPT_ROUNDS } from '../../auth.constants.js';
import type { AccessTokenResult } from '../../auth.types.js';
import { TokenService } from '../../token.service.js';
import { RegisterUserCommand } from '../register-user.command.js';

// instead of a service
@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password }: RegisterUserCommand): Promise<AccessTokenResult> {
    const normalized = email.toLowerCase();

    try {
      const user = await this.prisma.user.create({
        data: { email: normalized, passwordHash: await hash(password, BCRYPT_ROUNDS) },
      });

      return await this.tokens.issue(user.id, user.email);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User with this e-mail already exists');
      }

      throw error;
    }
  }
}

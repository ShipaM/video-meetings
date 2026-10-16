import { ConflictException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { UserRecord } from '../../users.types.js';
import { CreateUserCommand } from '../create-user.command.js';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ email, passwordHash }: CreateUserCommand): Promise<UserRecord> {
    try {
      return await this.prisma.user.create({
        data: { email: email.toLowerCase(), passwordHash },
        select: { id: true, email: true, passwordHash: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User with this e-mail already exists');
      }

      throw error;
    }
  }
}

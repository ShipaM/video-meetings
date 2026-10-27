import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { UpdatePasswordHashCommand } from '../update-password-hash.command.js';

@CommandHandler(UpdatePasswordHashCommand)
export class UpdatePasswordHashHandler implements ICommandHandler<UpdatePasswordHashCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, passwordHash }: UpdatePasswordHashCommand): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('User not found');
      }

      throw error;
    }
  }
}

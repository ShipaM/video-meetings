import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { UserProfile } from '../../users.types.js';
import { UpdateProfileCommand } from '../update-profile.command.js';

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, name }: UpdateProfileCommand): Promise<UserProfile> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { name: name === undefined ? undefined : name?.trim() || null },
        select: { email: true, name: true },
      });

      return { ...user, avatar: null };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('User not found');
      }

      throw error;
    }
  }
}

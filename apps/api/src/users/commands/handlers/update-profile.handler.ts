import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { GetProfileQuery } from '../../queries/index.js';
import type { UserProfile } from '../../users.types.js';
import { UpdateProfileCommand } from '../update-profile.command.js';

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, name, avatarUploadId }: UpdateProfileCommand): Promise<UserProfile> {
    // Row first, then data: the replaced or removed avatar's row goes in the same transaction as
    // the update, its data only after the commit, so a crash leaves an orphan file, never a row
    // without data.
    const replacedAvatarId = await this.prisma.$transaction(async (tx) => {
      // Locked until the commit: a concurrent update waits and then sees the avatar set here, so
      // every replaced avatar is deleted.
      const [user] = await tx.$queryRaw<{ avatarId: string | null }[]>`
        SELECT "avatarId" FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (avatarUploadId) {
        const avatar = await tx.userAvatar.findUnique({
          where: { id: avatarUploadId },
          select: { userId: true, status: true },
        });
        if (avatar?.userId !== userId) {
          throw new NotFoundException('Avatar upload not found');
        }
        if (avatar.status !== 'READY') {
          throw new ConflictException('Avatar upload is not complete');
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          name: name === undefined ? undefined : name?.trim() || null,
          avatarId: avatarUploadId,
        },
      });

      const replaced =
        avatarUploadId !== undefined && user.avatarId !== avatarUploadId ? user.avatarId : null;
      if (replaced) {
        await tx.userAvatar.deleteMany({ where: { id: replaced } });
      }
      return replaced;
    });

    if (replacedAvatarId) {
      await this.storage.removeQuietly(replacedAvatarId, `replaced avatar ${replacedAvatarId}`);
    }

    return this.queryBus.execute(new GetProfileQuery(userId));
  }
}

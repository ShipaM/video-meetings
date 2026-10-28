import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FindAvatarStorageKeysQuery } from '../find-avatar-storage-keys.query.js';

@QueryHandler(FindAvatarStorageKeysQuery)
export class FindAvatarStorageKeysHandler implements IQueryHandler<FindAvatarStorageKeysQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ keys }: FindAvatarStorageKeysQuery): Promise<string[]> {
    if (keys.length === 0) {
      return [];
    }
    // The avatar id is its storage key.
    const rows = await this.prisma.userAvatar.findMany({
      where: { id: { in: keys } },
      select: { id: true },
    });
    return rows.map(({ id }) => id);
  }
}

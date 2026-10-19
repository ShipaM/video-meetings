import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { UserRecord } from '../../users.types.js';
import { FindUsersByIdsQuery } from '../find-users-by-ids.query.js';

@QueryHandler(FindUsersByIdsQuery)
export class FindUsersByIdsHandler implements IQueryHandler<FindUsersByIdsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ids }: FindUsersByIdsQuery): Promise<UserRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, passwordHash: true },
    });
  }
}

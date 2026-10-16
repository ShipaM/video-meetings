import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { UserRecord } from '../../users.types.js';
import { FindUserByIdQuery } from '../find-user-by-id.query.js';

@QueryHandler(FindUserByIdQuery)
export class FindUserByIdHandler implements IQueryHandler<FindUserByIdQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute({ id }: FindUserByIdQuery): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, passwordHash: true },
    });
  }
}

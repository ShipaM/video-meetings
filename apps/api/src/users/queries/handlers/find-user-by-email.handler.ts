import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { UserRecord } from '../../users.types.js';
import { FindUserByEmailQuery } from '../find-user-by-email.query.js';

@QueryHandler(FindUserByEmailQuery)
export class FindUserByEmailHandler implements IQueryHandler<FindUserByEmailQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute({ email }: FindUserByEmailQuery): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, passwordHash: true },
    });
  }
}

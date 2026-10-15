import { Query } from '@nestjs/cqrs';
import type { Meeting } from '../../generated/prisma/client.js';

export class GetMeetingQuery extends Query<Meeting> {
  constructor(
    public readonly ownerId: string,
    public readonly id: string,
  ) {
    super();
  }
}

import { Query } from '@nestjs/cqrs';
import type { Meeting } from '../../generated/prisma/client.js';

export class ListMeetingsQuery extends Query<Meeting[]> {
  constructor(public readonly ownerId: string) {
    super();
  }
}

import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUsersByIdsQuery } from '../../../users/index.js';
import type { ParticipantView } from '../../meetings.types.js';
import { GetMeetingQuery } from '../get-meeting.query.js';
import { ListParticipantsQuery } from '../list-participants.query.js';

@QueryHandler(ListParticipantsQuery)
export class ListParticipantsHandler implements IQueryHandler<ListParticipantsQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ userId, meetingId }: ListParticipantsQuery): Promise<ParticipantView[]> {
    // 404 for a stranger, 403 for a participant.
    await this.queryBus.execute(new GetMeetingQuery(userId, meetingId, 'manage'));

    const participants = await this.prisma.meetingParticipant.findMany({
      where: { meetingId },
      orderBy: [{ addedAt: 'asc' }, { userId: 'asc' }],
    });
    // E-mails live in the Users module: one query for all of them.
    const users = await this.queryBus.execute(
      new FindUsersByIdsQuery(participants.map((participant) => participant.userId)),
    );
    const emails = new Map(users.map((user) => [user.id, user.email]));

    // A user deleted meanwhile takes the participant row with it (cascade): skip it.
    return participants.flatMap(({ userId: id, addedAt }) => {
      const email = emails.get(id);
      return email ? [{ userId: id, email, addedAt }] : [];
    });
  }
}

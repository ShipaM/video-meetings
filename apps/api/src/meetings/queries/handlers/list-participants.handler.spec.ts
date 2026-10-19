import { ForbiddenException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUsersByIdsQuery } from '../../../users/index.js';
import { GetMeetingQuery } from '../get-meeting.query.js';
import { ListParticipantsQuery } from '../list-participants.query.js';
import { ListParticipantsHandler } from './list-participants.handler.js';

describe('ListParticipantsHandler', () => {
  const findMany = vi.fn();
  const execute = vi.fn();
  const handler = new ListParticipantsHandler(
    { meetingParticipant: { findMany } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
  );

  const addedAt = new Date('2030-01-01T10:00:00Z');

  beforeEach(() => {
    findMany.mockReset();
    execute.mockReset();
  });

  it('checks manage access, then returns the participants with their e-mails', async () => {
    findMany.mockResolvedValue([
      { meetingId: 'm1', userId: 'u2', addedAt },
      { meetingId: 'm1', userId: 'u3', addedAt },
    ]);
    execute.mockResolvedValueOnce({ id: 'm1', role: 'owner' }).mockResolvedValueOnce([
      { id: 'u3', email: 'c@example.com' },
      { id: 'u2', email: 'b@example.com' },
    ]);

    await expect(handler.execute(new ListParticipantsQuery('u1', 'm1'))).resolves.toEqual([
      { userId: 'u2', email: 'b@example.com', addedAt },
      { userId: 'u3', email: 'c@example.com', addedAt },
    ]);
    expect(execute).toHaveBeenNthCalledWith(1, new GetMeetingQuery('u1', 'm1', 'manage'));
    expect(execute).toHaveBeenNthCalledWith(2, new FindUsersByIdsQuery(['u2', 'u3']));
  });

  it('skips a participant whose user is gone', async () => {
    findMany.mockResolvedValue([{ meetingId: 'm1', userId: 'u2', addedAt }]);
    execute.mockResolvedValueOnce({ id: 'm1', role: 'owner' }).mockResolvedValueOnce([]);

    await expect(handler.execute(new ListParticipantsQuery('u1', 'm1'))).resolves.toEqual([]);
  });

  it('is forbidden to a participant (403)', async () => {
    execute.mockRejectedValue(new ForbiddenException());

    await expect(handler.execute(new ListParticipantsQuery('u2', 'm1'))).rejects.toThrow(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});

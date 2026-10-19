import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { GetMeetingQuery } from '../get-meeting.query.js';
import { GetMeetingHandler } from './get-meeting.handler.js';

describe('GetMeetingHandler', () => {
  const findFirst = vi.fn();
  const handler = new GetMeetingHandler({ meeting: { findFirst } } as unknown as PrismaService);

  const meeting = {
    id: 'm1',
    title: 'Planning',
    startsAt: new Date('2030-01-01T10:00:00Z'),
    ownerId: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    findFirst.mockReset();
  });

  it('looks the meeting up among those the user owns or participates in', async () => {
    findFirst.mockResolvedValue(meeting);

    await handler.execute(new GetMeetingQuery('u1', 'm1'));

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'm1',
        OR: [{ ownerId: 'u1' }, { participants: { some: { userId: 'u1' } } }],
      },
    });
  });

  it('marks the owner as owner, also for manage access', async () => {
    findFirst.mockResolvedValue(meeting);

    await expect(
      handler.execute(new GetMeetingQuery('owner', 'm1', 'manage')),
    ).resolves.toMatchObject({ id: 'm1', role: 'owner' });
  });

  it('lets a participant view the meeting', async () => {
    findFirst.mockResolvedValue(meeting);

    await expect(handler.execute(new GetMeetingQuery('u1', 'm1'))).resolves.toMatchObject({
      role: 'participant',
    });
  });

  it('forbids a participant to manage the meeting (403)', async () => {
    findFirst.mockResolvedValue(meeting);

    await expect(handler.execute(new GetMeetingQuery('u1', 'm1', 'manage'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('hides a meeting the user has no part in (404)', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetMeetingQuery('u2', 'm1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

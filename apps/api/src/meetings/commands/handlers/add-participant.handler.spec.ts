import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUserByEmailQuery } from '../../../users/index.js';
import { GetMeetingQuery } from '../../queries/get-meeting.query.js';
import { AddParticipantCommand } from '../add-participant.command.js';
import { AddParticipantHandler } from './add-participant.handler.js';

describe('AddParticipantHandler', () => {
  const create = vi.fn();
  const execute = vi.fn();
  const handler = new AddParticipantHandler(
    { meetingParticipant: { create } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
  );

  const meeting = { id: 'm1', ownerId: 'owner', role: 'owner' };
  const user = { id: 'u2', email: 'b@example.com', passwordHash: 'hash' };
  const addedAt = new Date('2030-01-01T10:00:00Z');

  beforeEach(() => {
    create.mockReset();
    execute.mockReset();
  });

  it('adds the registered user and returns them without the password hash', async () => {
    execute.mockResolvedValueOnce(meeting).mockResolvedValueOnce(user);
    create.mockResolvedValue({ meetingId: 'm1', userId: 'u2', addedAt });

    await expect(
      handler.execute(new AddParticipantCommand('owner', 'm1', 'B@example.com')),
    ).resolves.toEqual({ userId: 'u2', email: 'b@example.com', addedAt });
    expect(execute).toHaveBeenNthCalledWith(1, new GetMeetingQuery('owner', 'm1', 'manage'));
    expect(execute).toHaveBeenNthCalledWith(2, new FindUserByEmailQuery('B@example.com'));
    expect(create).toHaveBeenCalledWith({ data: { meetingId: 'm1', userId: 'u2' } });
  });

  it('rejects an unregistered e-mail (404)', async () => {
    execute.mockResolvedValueOnce(meeting).mockResolvedValueOnce(null);

    await expect(
      handler.execute(new AddParticipantCommand('owner', 'm1', 'nobody@example.com')),
    ).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects the e-mail of the owner (400)', async () => {
    execute
      .mockResolvedValueOnce(meeting)
      .mockResolvedValueOnce({ ...user, id: 'owner', email: 'owner@example.com' });

    await expect(
      handler.execute(new AddParticipantCommand('owner', 'm1', 'owner@example.com')),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an existing participant (409)', async () => {
    execute.mockResolvedValueOnce(meeting).mockResolvedValueOnce(user);
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      handler.execute(new AddParticipantCommand('owner', 'm1', 'b@example.com')),
    ).rejects.toThrow(ConflictException);
  });

  it('passes other database errors through', async () => {
    execute.mockResolvedValueOnce(meeting).mockResolvedValueOnce(user);
    create.mockRejectedValue(new Error('database down'));

    await expect(
      handler.execute(new AddParticipantCommand('owner', 'm1', 'b@example.com')),
    ).rejects.toThrow('database down');
  });

  it('is forbidden to a participant (403) before any lookup', async () => {
    execute.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      handler.execute(new AddParticipantCommand('u2', 'm1', 'c@example.com')),
    ).rejects.toThrow(ForbiddenException);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});

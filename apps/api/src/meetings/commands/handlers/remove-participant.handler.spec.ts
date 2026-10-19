import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { GetMeetingQuery } from '../../queries/get-meeting.query.js';
import { RemoveParticipantCommand } from '../remove-participant.command.js';
import { RemoveParticipantHandler } from './remove-participant.handler.js';

describe('RemoveParticipantHandler', () => {
  const deleteMany = vi.fn();
  const execute = vi.fn();
  const handler = new RemoveParticipantHandler(
    { meetingParticipant: { deleteMany } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
  );

  beforeEach(() => {
    deleteMany.mockReset();
    execute.mockReset();
  });

  it('checks manage access and removes the participant', async () => {
    execute.mockResolvedValue({ id: 'm1', role: 'owner' });
    deleteMany.mockResolvedValue({ count: 1 });

    await handler.execute(new RemoveParticipantCommand('owner', 'm1', 'u2'));

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('owner', 'm1', 'manage'));
    expect(deleteMany).toHaveBeenCalledWith({ where: { meetingId: 'm1', userId: 'u2' } });
  });

  it('answers 404 for a user who is not a participant', async () => {
    execute.mockResolvedValue({ id: 'm1', role: 'owner' });
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      handler.execute(new RemoveParticipantCommand('owner', 'm1', 'u9')),
    ).rejects.toThrow(NotFoundException);
  });

  it('is forbidden to a participant (403)', async () => {
    execute.mockRejectedValue(new ForbiddenException());

    await expect(handler.execute(new RemoveParticipantCommand('u2', 'm1', 'u2'))).rejects.toThrow(
      ForbiddenException,
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

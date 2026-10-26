import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { UpdateProfileCommand } from '../update-profile.command.js';
import { UpdateProfileHandler } from './update-profile.handler.js';

describe('UpdateProfileHandler', () => {
  const update = vi.fn();
  const handler = new UpdateProfileHandler({ user: { update } } as unknown as PrismaService);

  beforeEach(() => {
    update.mockReset();
    update.mockResolvedValue({ email: 'a@example.com', name: 'Ada' });
  });

  it('saves the trimmed name and returns the profile', async () => {
    await expect(handler.execute(new UpdateProfileCommand('u1', '  Ada  '))).resolves.toEqual({
      email: 'a@example.com',
      name: 'Ada',
      avatar: null,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Ada' },
      select: { email: true, name: true },
    });
  });

  it.each(['', '   ', null])('stores null for the name %j', async (name) => {
    await handler.execute(new UpdateProfileCommand('u1', name));

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: null } }));
  });

  it('leaves the name unchanged when it is not given', async () => {
    await handler.execute(new UpdateProfileCommand('u1'));

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: undefined } }));
  });

  it('throws NotFoundException when there is no such user', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(handler.execute(new UpdateProfileCommand('missing', 'Ada'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rethrows unexpected errors', async () => {
    update.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(new UpdateProfileCommand('u1', 'Ada'))).rejects.toThrow('db down');
  });
});

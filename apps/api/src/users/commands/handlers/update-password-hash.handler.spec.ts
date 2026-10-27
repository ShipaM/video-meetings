import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { UpdatePasswordHashCommand } from '../update-password-hash.command.js';
import { UpdatePasswordHashHandler } from './update-password-hash.handler.js';

describe('UpdatePasswordHashHandler', () => {
  const update = vi.fn();
  const handler = new UpdatePasswordHashHandler({ user: { update } } as unknown as PrismaService);

  beforeEach(() => {
    update.mockReset();
    update.mockResolvedValue({ id: 'u1' });
  });

  it('stores the new hash of the user', async () => {
    await expect(
      handler.execute(new UpdatePasswordHashCommand('u1', 'new-hash')),
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'new-hash' },
      select: { id: true },
    });
  });

  it('throws NotFoundException when there is no such user', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(
      handler.execute(new UpdatePasswordHashCommand('missing', 'new-hash')),
    ).rejects.toThrow(NotFoundException);
  });

  it('rethrows unexpected errors', async () => {
    update.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(new UpdatePasswordHashCommand('u1', 'new-hash'))).rejects.toThrow(
      'db down',
    );
  });
});

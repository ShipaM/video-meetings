import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { GetProfileQuery } from '../get-profile.query.js';
import { GetProfileHandler } from './get-profile.handler.js';

describe('GetProfileHandler', () => {
  const findUnique = vi.fn();
  const handler = new GetProfileHandler({ user: { findUnique } } as unknown as PrismaService);

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('returns the profile of the user without an avatar', async () => {
    findUnique.mockResolvedValue({ email: 'a@example.com', name: 'Ada' });

    await expect(handler.execute(new GetProfileQuery('u1'))).resolves.toEqual({
      email: 'a@example.com',
      name: 'Ada',
      avatar: null,
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
  });

  it('never loads the password hash', async () => {
    findUnique.mockResolvedValue({ email: 'a@example.com', name: null });

    await handler.execute(new GetProfileQuery('u1'));

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: { email: true, name: true } }),
    );
  });

  it('throws NotFoundException when there is no such user', async () => {
    findUnique.mockResolvedValue(null);

    await expect(handler.execute(new GetProfileQuery('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

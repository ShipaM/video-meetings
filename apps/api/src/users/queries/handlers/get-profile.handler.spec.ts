import { NotFoundException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { AVATAR_LINK_AUDIENCE, AVATAR_LINK_WINDOW_SECONDS } from '../../users.config.js';
import { GetProfileQuery } from '../get-profile.query.js';
import { GetProfileHandler } from './get-profile.handler.js';

describe('GetProfileHandler', () => {
  const findUnique = vi.fn();
  const signAsync = vi.fn();
  const handler = new GetProfileHandler(
    { user: { findUnique } } as unknown as PrismaService,
    { signAsync } as unknown as JwtService,
  );

  beforeEach(() => {
    findUnique.mockReset();
    signAsync.mockReset();
    signAsync.mockResolvedValue('signed.avatar.token');
    vi.stubEnv('FILE_LINK_SECRET', 'link-secret');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('returns the profile of a user without an avatar', async () => {
    findUnique.mockResolvedValue({ email: 'a@example.com', name: 'Ada', avatarId: null });

    await expect(handler.execute(new GetProfileQuery('u1'))).resolves.toEqual({
      email: 'a@example.com',
      name: 'Ada',
      avatar: null,
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('returns a signed content URL for the avatar', async () => {
    findUnique.mockResolvedValue({ email: 'a@example.com', name: null, avatarId: 'av1' });

    await expect(handler.execute(new GetProfileQuery('u1'))).resolves.toEqual({
      email: 'a@example.com',
      name: null,
      avatar: '/avatars/av1/content?token=signed.avatar.token',
    });
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', avatarId: 'av1' }),
      {
        secret: 'link-secret',
        audience: AVATAR_LINK_AUDIENCE,
        expiresIn: 2 * AVATAR_LINK_WINDOW_SECONDS,
      },
    );
  });

  it('rounds the issue time to a window, so the URL is the same between loads', async () => {
    findUnique.mockResolvedValue({ email: 'a@example.com', name: null, avatarId: 'av1' });
    const window = AVATAR_LINK_WINDOW_SECONDS;
    const windowStart = 1_800_000_000 - (1_800_000_000 % window);
    vi.useFakeTimers();

    vi.setSystemTime(windowStart * 1000 + 1000);
    await handler.execute(new GetProfileQuery('u1'));
    vi.setSystemTime((windowStart + window) * 1000 - 1000);
    await handler.execute(new GetProfileQuery('u1'));

    const [first, second] = signAsync.mock.calls.map(([payload]) => payload as { iat: number });
    expect(first.iat).toBe(windowStart);
    expect(second).toEqual(first);
  });

  it('never loads the password hash', async () => {
    findUnique.mockResolvedValue({ email: 'a@example.com', name: null, avatarId: null });

    await handler.execute(new GetProfileQuery('u1'));

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: { email: true, name: true, avatarId: true } }),
    );
  });

  it('throws NotFoundException when there is no such user', async () => {
    findUnique.mockResolvedValue(null);

    await expect(handler.execute(new GetProfileQuery('missing'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

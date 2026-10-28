import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../../storage/files-storage.service.js';
import { AVATAR_LINK_AUDIENCE } from '../../users.config.js';
import { GetAvatarContentQuery } from '../get-avatar-content.query.js';
import { GetAvatarContentHandler } from './get-avatar-content.handler.js';

describe('GetAvatarContentHandler', () => {
  const findFirst = vi.fn();
  const verifyAsync = vi.fn();
  const pathOf = vi.fn((key: string) => `/files/uploads/${key}`);
  const handler = new GetAvatarContentHandler(
    { userAvatar: { findFirst } } as unknown as PrismaService,
    { verifyAsync } as unknown as JwtService,
    { pathOf } as unknown as FilesStorageService,
  );

  beforeEach(() => {
    findFirst.mockReset();
    verifyAsync.mockReset();
    verifyAsync.mockResolvedValue({ sub: 'u1', avatarId: 'av1' });
    findFirst.mockResolvedValue({ mimeType: 'image/png' });
    vi.stubEnv('FILE_LINK_SECRET', 'link-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the stored file of the user's current avatar", async () => {
    await expect(handler.execute(new GetAvatarContentQuery('av1', 'tok'))).resolves.toEqual({
      path: '/files/uploads/av1',
      mimeType: 'image/png',
    });
    expect(verifyAsync).toHaveBeenCalledWith('tok', {
      secret: 'link-secret',
      audience: AVATAR_LINK_AUDIENCE,
    });
    // Still attached to the profile of the user the link was issued to.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'av1', currentOf: { id: 'u1' } } }),
    );
  });

  it('rejects a missing token', async () => {
    await expect(handler.execute(new GetAvatarContentQuery('av1', undefined))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(handler.execute(new GetAvatarContentQuery('av1', 'tok'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token issued for another avatar', async () => {
    verifyAsync.mockResolvedValue({ sub: 'u1', avatarId: 'av2' });

    await expect(handler.execute(new GetAvatarContentQuery('av1', 'tok'))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('answers NotFoundException once the avatar is replaced or removed', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetAvatarContentQuery('av1', 'tok'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

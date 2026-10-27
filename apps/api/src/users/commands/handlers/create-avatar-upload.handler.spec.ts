import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { MAX_AVATAR_SIZE } from '../../avatar-types.js';
import { CreateAvatarUploadCommand } from '../create-avatar-upload.command.js';
import { CreateAvatarUploadHandler } from './create-avatar-upload.handler.js';

describe('CreateAvatarUploadHandler', () => {
  const create = vi.fn();
  const handler = new CreateAvatarUploadHandler({
    userAvatar: { create },
  } as unknown as PrismaService);

  beforeEach(() => {
    create.mockReset();
  });

  it('registers an UPLOADING avatar with the canonical MIME type', async () => {
    await handler.execute(
      new CreateAvatarUploadCommand('u1', 'a1', 1024, {
        purpose: 'avatar',
        filename: 'C:\\photos\\me.JPG',
        filetype: 'image/jpg',
      }),
    );

    expect(create).toHaveBeenCalledWith({
      data: { id: 'a1', userId: 'u1', mimeType: 'image/jpeg', size: 1024 },
    });
  });

  it('accepts exactly 5 MB', async () => {
    await handler.execute(
      new CreateAvatarUploadCommand('u1', 'a1', MAX_AVATAR_SIZE, {
        filename: 'me.png',
        filetype: 'image/png',
      }),
    );

    expect(create).toHaveBeenCalled();
  });

  it('rejects a declared size over 5 MB (413) without a row', async () => {
    await expect(
      handler.execute(
        new CreateAvatarUploadCommand('u1', 'a1', MAX_AVATAR_SIZE + 1, {
          filename: 'me.png',
          filetype: 'image/png',
        }),
      ),
    ).rejects.toThrow(PayloadTooLargeException);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [{ filename: 'me.gif', filetype: 'image/gif' }],
    [{ filename: 'me.png', filetype: 'application/pdf' }],
    [{ filetype: 'image/png' }],
    [{ filename: '  ', filetype: 'image/png' }],
  ])('rejects a type outside PNG, JPEG and WebP (400) without a row: %o', async (metadata) => {
    await expect(
      handler.execute(new CreateAvatarUploadCommand('u1', 'a1', 1024, metadata)),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

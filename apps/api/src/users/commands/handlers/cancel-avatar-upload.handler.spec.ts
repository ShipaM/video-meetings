import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CancelAvatarUploadCommand } from '../cancel-avatar-upload.command.js';
import { CancelAvatarUploadHandler } from './cancel-avatar-upload.handler.js';

describe('CancelAvatarUploadHandler', () => {
  const findUnique = vi.fn();
  const deleteMany = vi.fn();
  const handler = new CancelAvatarUploadHandler({
    userAvatar: { findUnique, deleteMany },
  } as unknown as PrismaService);

  beforeEach(() => {
    findUnique.mockReset();
    deleteMany.mockReset();
  });

  it("deletes the user's row in one query while it is UPLOADING", async () => {
    deleteMany.mockResolvedValue({ count: 1 });

    await handler.execute(new CancelAvatarUploadCommand('u1', 'a1'));

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'a1', userId: 'u1', status: 'UPLOADING' },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("hides another user's avatar upload (404)", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ userId: 'u1' });

    await expect(handler.execute(new CancelAvatarUploadCommand('u2', 'a1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'a1' }, select: { userId: true } });
  });

  it('answers 404 for a missing upload', async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(null);

    await expect(handler.execute(new CancelAvatarUploadCommand('u1', 'a1'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses to cancel a completed upload (409), so tus keeps its data', async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ userId: 'u1' });

    await expect(handler.execute(new CancelAvatarUploadCommand('u1', 'a1'))).rejects.toThrow(
      ConflictException,
    );
  });
});

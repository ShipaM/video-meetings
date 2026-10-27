import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../../storage/files-storage.service.js';
import { AuthorizeAvatarUploadRequestCommand } from '../authorize-avatar-upload-request.command.js';
import { CompleteAvatarUploadCommand } from '../complete-avatar-upload.command.js';
import { AuthorizeAvatarUploadRequestHandler } from './authorize-avatar-upload-request.handler.js';

describe('AuthorizeAvatarUploadRequestHandler', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const execute = vi.fn();
  const getUpload = vi.fn();
  const handler = new AuthorizeAvatarUploadRequestHandler(
    { userAvatar: { findUnique, updateMany } } as unknown as PrismaService,
    { execute } as unknown as CommandBus,
    { store: { getUpload } } as unknown as FilesStorageService,
  );

  const uploading = { id: 'a1', userId: 'u1', status: 'UPLOADING', size: 100 };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hides another user's avatar upload (404) and writes nothing", async () => {
    findUnique.mockResolvedValue(uploading);

    for (const method of ['HEAD', 'PATCH']) {
      await expect(
        handler.execute(new AuthorizeAvatarUploadRequestCommand('u2', 'a1', method)),
      ).rejects.toThrow(NotFoundException);
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(getUpload).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing upload', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'missing', 'HEAD')),
    ).rejects.toThrow(NotFoundException);
  });

  it('records chunk activity on PATCH', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });
    updateMany.mockResolvedValue({ count: 1 });

    await handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'a1', 'PATCH'));

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'UPLOADING' },
      data: { lastChunkAt: expect.any(Date) as Date },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('answers 404 on PATCH when the upload was cancelled or cleaned up meanwhile', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'a1', 'PATCH')),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not write anything on HEAD of an upload in progress', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });

    await handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'a1', 'HEAD'));

    expect(updateMany).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('completes an upload whose bytes are all stored but whose completion failed', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 100 });

    await handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'a1', 'HEAD'));

    const command = execute.mock.calls[0][0] as CompleteAvatarUploadCommand;
    expect(command).toBeInstanceOf(CompleteAvatarUploadCommand);
    expect(command.uploadId).toBe('a1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows HEAD but rejects PATCH (409) once the upload is complete', async () => {
    findUnique.mockResolvedValue({ ...uploading, status: 'READY' });

    await expect(
      handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'a1', 'HEAD')),
    ).resolves.toBeUndefined();
    await expect(
      handler.execute(new AuthorizeAvatarUploadRequestCommand('u1', 'a1', 'PATCH')),
    ).rejects.toThrow(ConflictException);
    expect(getUpload).not.toHaveBeenCalled();
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { AuthorizeUploadRequestCommand } from '../authorize-upload-request.command.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';
import { AuthorizeUploadRequestHandler } from './authorize-upload-request.handler.js';

describe('AuthorizeUploadRequestHandler', () => {
  const findFirst = vi.fn();
  const update = vi.fn();
  const execute = vi.fn();
  const getUpload = vi.fn();
  const handler = new AuthorizeUploadRequestHandler(
    { meetingFile: { findFirst, update } } as unknown as PrismaService,
    { execute } as unknown as CommandBus,
    { store: { getUpload } } as unknown as FilesStorageService,
  );

  const uploading = { id: 'f1', storageKey: 'f1', status: 'UPLOADING', size: 100n };

  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
    execute.mockReset();
    getUpload.mockReset();
  });

  it("hides another user's upload (404)", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u2', 'f1', 'HEAD')),
    ).rejects.toThrow(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'f1', uploadedById: 'u2' } });
  });

  it('records chunk activity on PATCH', async () => {
    findFirst.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'PATCH'));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { lastChunkAt: expect.any(Date) as Date },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not write anything on HEAD of an upload in progress', async () => {
    findFirst.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD'));

    expect(update).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('completes an upload whose bytes are all stored but whose completion failed', async () => {
    findFirst.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 100 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD'));

    const command = execute.mock.calls[0][0] as CompleteUploadCommand;
    expect(command).toBeInstanceOf(CompleteUploadCommand);
    expect(command.fileId).toBe('f1');
  });

  it('allows HEAD but rejects PATCH (409) once the upload is complete', async () => {
    findFirst.mockResolvedValue({ ...uploading, status: 'READY' });

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD')),
    ).resolves.toMatchObject({ status: 'READY' });
    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'PATCH')),
    ).rejects.toThrow(ConflictException);
    expect(getUpload).not.toHaveBeenCalled();
  });
});

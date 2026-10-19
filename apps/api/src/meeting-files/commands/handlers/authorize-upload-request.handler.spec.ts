import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { AuthorizeUploadRequestCommand } from '../authorize-upload-request.command.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';
import { AuthorizeUploadRequestHandler } from './authorize-upload-request.handler.js';

describe('AuthorizeUploadRequestHandler', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const execute = vi.fn();
  const query = vi.fn();
  const getUpload = vi.fn();
  const handler = new AuthorizeUploadRequestHandler(
    { meetingFile: { findUnique, updateMany } } as unknown as PrismaService,
    { execute } as unknown as CommandBus,
    { execute: query } as unknown as QueryBus,
    { store: { getUpload } } as unknown as FilesStorageService,
  );

  const uploading = {
    id: 'f1',
    meetingId: 'm1',
    uploadedById: 'u1',
    storageKey: 'f1',
    status: 'UPLOADING',
    size: 100n,
  };

  beforeEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
    execute.mockReset();
    query.mockReset();
    getUpload.mockReset();
  });

  it("hides another user's upload from a stranger (404) with a single read", async () => {
    findUnique.mockResolvedValue(uploading);
    query.mockRejectedValue(new NotFoundException());

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u2', 'f1', 'HEAD')),
    ).rejects.toThrow(NotFoundException);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(query).toHaveBeenCalledWith(new GetMeetingQuery('u2', 'm1', 'manage'));
  });

  it("forbids a participant to touch the owner's upload (403)", async () => {
    findUnique.mockResolvedValue(uploading);
    query.mockRejectedValue(new ForbiddenException());

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u3', 'f1', 'PATCH')),
    ).rejects.toThrow(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 to the meeting owner for an upload of somebody else', async () => {
    findUnique.mockResolvedValue(uploading);
    query.mockResolvedValue({ id: 'm1', role: 'owner' });

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u4', 'f1', 'HEAD')),
    ).rejects.toThrow(NotFoundException);
  });

  it('answers 404 for a missing upload without checking any meeting', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u1', 'missing', 'HEAD')),
    ).rejects.toThrow(NotFoundException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not check the meeting for the uploader', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD'));

    expect(query).not.toHaveBeenCalled();
  });

  it('records chunk activity on PATCH', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });
    updateMany.mockResolvedValue({ count: 1 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'PATCH'));

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'UPLOADING' },
      data: { lastChunkAt: expect.any(Date) as Date },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('answers 404 on PATCH when the upload was cancelled or cleaned up meanwhile', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'PATCH')),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not write anything on HEAD of an upload in progress', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 40 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD'));

    expect(updateMany).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('completes an upload whose bytes are all stored but whose completion failed', async () => {
    findUnique.mockResolvedValue(uploading);
    getUpload.mockResolvedValue({ offset: 100 });

    await handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD'));

    const command = execute.mock.calls[0][0] as CompleteUploadCommand;
    expect(command).toBeInstanceOf(CompleteUploadCommand);
    expect(command.fileId).toBe('f1');
  });

  it('allows HEAD but rejects PATCH (409) once the upload is complete', async () => {
    findUnique.mockResolvedValue({ ...uploading, status: 'READY' });

    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'HEAD')),
    ).resolves.toMatchObject({ status: 'READY' });
    await expect(
      handler.execute(new AuthorizeUploadRequestCommand('u1', 'f1', 'PATCH')),
    ).rejects.toThrow(ConflictException);
    expect(getUpload).not.toHaveBeenCalled();
  });
});

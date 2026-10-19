import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import type { ProcessingQueue } from '../../processing/processing-queue.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';
import { CompleteUploadHandler } from './complete-upload.handler.js';

describe('CompleteUploadHandler', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const deleteMany = vi.fn();
  const removeQuietly = vi.fn();
  const start = vi.fn();
  let dir: string;

  const handler = new CompleteUploadHandler(
    {
      meetingFile: { findUnique, updateMany, deleteMany },
    } as unknown as PrismaService,
    {
      pathOf: (key: string) => path.join(dir, key),
      removeQuietly,
    } as unknown as FilesStorageService,
    { start } as unknown as ProcessingQueue,
  );

  const uploading = {
    id: 'f1',
    storageKey: 'f1',
    status: 'UPLOADING',
    kind: 'DOCUMENT',
    mimeType: 'text/plain',
  };
  const image = { ...uploading, kind: 'IMAGE', mimeType: 'image/png' };
  /** A PNG signature and IHDR chunk: detected as image/png. */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.alloc(32, 1),
  ]);
  const notes = 'Plain meeting notes';

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'complete-upload-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
    deleteMany.mockReset();
    removeQuietly.mockReset();
    start.mockReset();
  });

  it('sends a document with matching content to PROCESSING and queues its job', async () => {
    await writeFile(path.join(dir, 'f1'), notes);
    updateMany.mockResolvedValue({ count: 1 });
    findUnique
      .mockResolvedValueOnce(uploading)
      .mockResolvedValueOnce({ ...uploading, status: 'PROCESSING', processingAttempt: 1 });

    await expect(handler.execute(new CompleteUploadCommand('f1'))).resolves.toMatchObject({
      status: 'PROCESSING',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'UPLOADING' },
      data: {
        status: 'PROCESSING',
        completedAt: expect.any(Date) as Date,
        processingAttempt: { increment: 1 },
      },
    });
    expect(start).toHaveBeenCalledWith('f1', 1);
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('makes an image READY at once, without a job', async () => {
    await writeFile(path.join(dir, 'f1'), png);
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValueOnce(image).mockResolvedValueOnce({ ...image, status: 'READY' });

    await handler.execute(new CompleteUploadCommand('f1'));

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'UPLOADING' },
      data: { status: 'READY', completedAt: expect.any(Date) as Date },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('queues no second job when a concurrent completion made the change', async () => {
    await writeFile(path.join(dir, 'f1'), notes);
    updateMany.mockResolvedValue({ count: 0 });
    findUnique
      .mockResolvedValueOnce(uploading)
      .mockResolvedValueOnce({ ...uploading, status: 'PROCESSING', processingAttempt: 1 });

    await handler.execute(new CompleteUploadCommand('f1'));

    expect(start).not.toHaveBeenCalled();
  });

  it('deletes the row and the data when the content does not match the type', async () => {
    await writeFile(path.join(dir, 'f1'), Buffer.from([0x00, 0x01, 0x02]));
    findUnique.mockResolvedValue(uploading);

    await expect(handler.execute(new CompleteUploadCommand('f1'))).rejects.toThrow(
      BadRequestException,
    );
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'f1', status: 'UPLOADING' } });
    expect(removeQuietly).toHaveBeenCalledWith('f1', 'mismatched upload f1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('treats a missing data file as a mismatch instead of failing', async () => {
    findUnique.mockResolvedValue({ ...uploading, storageKey: 'missing' });

    await expect(handler.execute(new CompleteUploadCommand('f1'))).rejects.toThrow(
      BadRequestException,
    );
    expect(removeQuietly).toHaveBeenCalledWith('missing', 'mismatched upload f1');
  });

  it('leaves a file that is no longer UPLOADING untouched', async () => {
    findUnique.mockResolvedValue({ ...uploading, status: 'READY' });

    await handler.execute(new CompleteUploadCommand('f1'));

    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('answers 404 when the upload was cancelled while it was being completed', async () => {
    await writeFile(path.join(dir, 'f1'), notes);
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce(uploading).mockResolvedValueOnce(null);

    await expect(handler.execute(new CompleteUploadCommand('f1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

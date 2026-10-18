import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';
import { CompleteUploadHandler } from './complete-upload.handler.js';

describe('CompleteUploadHandler', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const deleteMany = vi.fn();
  const removeQuietly = vi.fn();
  let dir: string;

  const handler = new CompleteUploadHandler(
    {
      meetingFile: { findUnique, updateMany, deleteMany },
    } as unknown as PrismaService,
    {
      pathOf: (key: string) => path.join(dir, key),
      removeQuietly,
    } as unknown as FilesStorageService,
  );

  const uploading = { id: 'f1', storageKey: 'f1', status: 'UPLOADING', mimeType: 'text/plain' };

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
  });

  it('marks a file with matching content as READY, only while it is UPLOADING', async () => {
    await writeFile(path.join(dir, 'f1'), 'Plain meeting notes\n');
    findUnique
      .mockResolvedValueOnce(uploading)
      .mockResolvedValueOnce({ ...uploading, status: 'READY' });

    await expect(handler.execute(new CompleteUploadCommand('f1'))).resolves.toMatchObject({
      status: 'READY',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'UPLOADING' },
      data: { status: 'READY', completedAt: expect.any(Date) as Date },
    });
    expect(removeQuietly).not.toHaveBeenCalled();
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
  });

  it('answers 404 when the upload was cancelled while it was being completed', async () => {
    await writeFile(path.join(dir, 'f1'), 'Plain meeting notes\n');
    findUnique.mockResolvedValueOnce(uploading).mockResolvedValueOnce(null);

    await expect(handler.execute(new CompleteUploadCommand('f1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

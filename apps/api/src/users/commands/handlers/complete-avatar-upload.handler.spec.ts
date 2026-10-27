import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../../storage/files-storage.service.js';
import { CompleteAvatarUploadCommand } from '../complete-avatar-upload.command.js';
import { CompleteAvatarUploadHandler } from './complete-avatar-upload.handler.js';

describe('CompleteAvatarUploadHandler', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const deleteMany = vi.fn();
  const removeQuietly = vi.fn();
  let dir: string;

  const handler = new CompleteAvatarUploadHandler(
    { userAvatar: { findUnique, updateMany, deleteMany } } as unknown as PrismaService,
    {
      pathOf: (key: string) => path.join(dir, key),
      removeQuietly,
    } as unknown as FilesStorageService,
  );

  const uploading = { id: 'a1', userId: 'u1', status: 'UPLOADING', mimeType: 'image/png' };
  /** A PNG signature and IHDR chunk: detected as image/png. */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.alloc(32, 1),
  ]);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'complete-avatar-upload-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('makes an avatar whose content matches its type READY', async () => {
    await writeFile(path.join(dir, 'a1'), png);
    findUnique.mockResolvedValue(uploading);
    updateMany.mockResolvedValue({ count: 1 });

    await handler.execute(new CompleteAvatarUploadCommand('a1'));

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'UPLOADING' },
      data: { status: 'READY' },
    });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('deletes the row, then the data when the content does not match the type (400)', async () => {
    await writeFile(path.join(dir, 'a1'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));
    findUnique.mockResolvedValue(uploading);

    await expect(handler.execute(new CompleteAvatarUploadCommand('a1'))).rejects.toThrow(
      BadRequestException,
    );
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'UPLOADING' } });
    expect(removeQuietly).toHaveBeenCalledWith('a1', 'mismatched avatar upload a1');
    expect(deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      removeQuietly.mock.invocationCallOrder[0],
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('treats a missing data file as a mismatch instead of failing', async () => {
    findUnique.mockResolvedValue({ ...uploading, id: 'missing' });

    await expect(handler.execute(new CompleteAvatarUploadCommand('missing'))).rejects.toThrow(
      BadRequestException,
    );
    expect(removeQuietly).toHaveBeenCalledWith('missing', 'mismatched avatar upload missing');
  });

  it('leaves an avatar that is already READY untouched (completion may run twice)', async () => {
    findUnique.mockResolvedValue({ ...uploading, status: 'READY' });

    await handler.execute(new CompleteAvatarUploadCommand('a1'));

    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing upload', async () => {
    findUnique.mockResolvedValue(null);

    await expect(handler.execute(new CompleteAvatarUploadCommand('a1'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('answers 404 when the upload was cancelled while it was being completed', async () => {
    await writeFile(path.join(dir, 'a1'), png);
    findUnique.mockResolvedValue(uploading);
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValueOnce(uploading).mockResolvedValueOnce(null);

    await expect(handler.execute(new CompleteAvatarUploadCommand('a1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

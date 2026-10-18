import type { CommandBus } from '@nestjs/cqrs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { ABANDONED_UPLOAD_MS } from '../../meeting-files.config.js';
import { CleanupAbandonedUploadsCommand } from '../cleanup-abandoned-uploads.command.js';
import { CompleteUploadCommand } from '../complete-upload.command.js';
import { CleanupAbandonedUploadsHandler } from './cleanup-abandoned-uploads.handler.js';

describe('CleanupAbandonedUploadsHandler', () => {
  const findMany = vi.fn();
  const deleteMany = vi.fn();
  const execute = vi.fn();
  const storedBytes = vi.fn();
  const removeQuietly = vi.fn();
  const handler = new CleanupAbandonedUploadsHandler(
    { meetingFile: { findMany, deleteMany } } as unknown as PrismaService,
    { execute } as unknown as CommandBus,
    { storedBytes, removeQuietly } as unknown as FilesStorageService,
  );

  const cutoff = new Date('2026-01-01T00:00:00.000Z');
  const partial = (id: string) => ({ id, storageKey: `k-${id}`, size: 100n });

  beforeEach(() => {
    findMany.mockReset();
    deleteMany.mockReset();
    execute.mockReset();
    storedBytes.mockReset();
    removeQuietly.mockReset();
    storedBytes.mockResolvedValue(40);
    removeQuietly.mockResolvedValue(true);
  });

  it('defaults the cutoff to 24 hours ago', () => {
    const before = Date.now();
    const { cutoff: defaultCutoff } = new CleanupAbandonedUploadsCommand();

    expect(defaultCutoff.getTime()).toBeGreaterThanOrEqual(before - ABANDONED_UPLOAD_MS);
    expect(defaultCutoff.getTime()).toBeLessThanOrEqual(Date.now() - ABANDONED_UPLOAD_MS);
  });

  it('deletes each partial upload with the same condition, then its data', async () => {
    findMany.mockResolvedValue([partial('f1'), partial('f2')]);
    deleteMany.mockResolvedValue({ count: 1 });

    await expect(handler.execute(new CleanupAbandonedUploadsCommand(cutoff))).resolves.toBe(2);

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'UPLOADING', lastChunkAt: { lt: cutoff } },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, storageKey: true, size: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'UPLOADING', lastChunkAt: { lt: cutoff } },
    });
    expect(removeQuietly).toHaveBeenCalledWith('k-f1', 'abandoned upload f1');
    expect(removeQuietly).toHaveBeenCalledWith('k-f2', 'abandoned upload f2');
  });

  it('reads further batches after the last id', async () => {
    const full = Array.from({ length: 100 }, (_, i) => partial(`a${String(i).padStart(3, '0')}`));
    findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([partial('b')]);
    deleteMany.mockResolvedValue({ count: 1 });

    await expect(handler.execute(new CleanupAbandonedUploadsCommand(cutoff))).resolves.toBe(101);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: 'UPLOADING', lastChunkAt: { lt: cutoff }, id: { gt: 'a099' } },
      }),
    );
  });

  it('keeps the data of an upload that received a chunk meanwhile', async () => {
    findMany.mockResolvedValue([partial('f1')]);
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(handler.execute(new CleanupAbandonedUploadsCommand(cutoff))).resolves.toBe(0);

    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('completes an upload whose bytes are all stored instead of deleting it', async () => {
    findMany.mockResolvedValue([partial('f1')]);
    storedBytes.mockResolvedValue(100);

    await expect(handler.execute(new CleanupAbandonedUploadsCommand(cutoff))).resolves.toBe(0);

    expect(execute).toHaveBeenCalledWith(new CompleteUploadCommand('f1'));
    expect(deleteMany).not.toHaveBeenCalled();
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('goes on when completing a stalled upload fails', async () => {
    findMany.mockResolvedValue([partial('f1'), partial('f2')]);
    storedBytes.mockImplementation((key: string) => Promise.resolve(key === 'k-f1' ? 100 : 40));
    execute.mockRejectedValue(new Error('database down'));
    deleteMany.mockResolvedValue({ count: 1 });

    await expect(handler.execute(new CleanupAbandonedUploadsCommand(cutoff))).resolves.toBe(1);

    expect(removeQuietly).toHaveBeenCalledWith('k-f2', 'abandoned upload f2');
  });
});

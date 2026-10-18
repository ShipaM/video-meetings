import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { ABANDONED_UPLOAD_MS } from '../../meeting-files.config.js';
import { CleanupAbandonedUploadsHandler } from './cleanup-abandoned-uploads.handler.js';

describe('CleanupAbandonedUploadsHandler', () => {
  const findMany = vi.fn();
  const deleteMany = vi.fn();
  const remove = vi.fn();
  const handler = new CleanupAbandonedUploadsHandler(
    { meetingFile: { findMany, deleteMany } } as unknown as PrismaService,
    { remove } as unknown as FilesStorageService,
  );

  beforeEach(() => {
    findMany.mockReset();
    deleteMany.mockReset();
    remove.mockReset();
  });

  it('looks for UPLOADING files with no chunk for 24 hours', async () => {
    findMany.mockResolvedValue([]);
    const before = Date.now();

    await expect(handler.execute()).resolves.toBe(0);

    const [{ where }] = findMany.mock.calls[0] as [
      { where: { status: string; lastChunkAt: { lt: Date } } },
    ];
    expect(where.status).toBe('UPLOADING');
    expect(where.lastChunkAt.lt.getTime()).toBeGreaterThanOrEqual(before - ABANDONED_UPLOAD_MS);
    expect(where.lastChunkAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - ABANDONED_UPLOAD_MS);
  });

  it('deletes each row with the same condition, then its data', async () => {
    findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'k1' },
      { id: 'f2', storageKey: 'k2' },
    ]);
    deleteMany.mockResolvedValue({ count: 1 });

    await expect(handler.execute()).resolves.toBe(2);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'UPLOADING', lastChunkAt: { lt: expect.any(Date) as Date } },
    });
    expect(remove).toHaveBeenCalledWith('k1');
    expect(remove).toHaveBeenCalledWith('k2');
  });

  it('keeps the data of an upload that received a chunk meanwhile', async () => {
    findMany.mockResolvedValue([{ id: 'f1', storageKey: 'k1' }]);
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(handler.execute()).resolves.toBe(0);

    expect(remove).not.toHaveBeenCalled();
  });

  it('goes on with the other uploads when removing data fails', async () => {
    findMany.mockResolvedValue([
      { id: 'f1', storageKey: 'k1' },
      { id: 'f2', storageKey: 'k2' },
    ]);
    deleteMany.mockResolvedValue({ count: 1 });
    remove.mockRejectedValueOnce(new Error('EBUSY'));

    await expect(handler.execute()).resolves.toBe(2);

    expect(remove).toHaveBeenCalledWith('k2');
  });
});

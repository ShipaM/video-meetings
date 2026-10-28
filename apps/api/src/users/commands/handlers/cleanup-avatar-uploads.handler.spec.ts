import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../../storage/files-storage.service.js';
import { CleanupAvatarUploadsCommand } from '../cleanup-avatar-uploads.command.js';
import { CleanupAvatarUploadsHandler } from './cleanup-avatar-uploads.handler.js';

describe('CleanupAvatarUploadsHandler', () => {
  const findMany = vi.fn();
  const lockAvatar = vi.fn();
  const deleteMany = vi.fn();
  const tx = { $queryRaw: lockAvatar, userAvatar: { deleteMany } };
  const transaction = vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const removeQuietly = vi.fn();
  const handler = new CleanupAvatarUploadsHandler(
    { userAvatar: { findMany }, $transaction: transaction } as unknown as PrismaService,
    { removeQuietly } as unknown as FilesStorageService,
  );

  const cutoff = new Date('2026-01-01T00:00:00.000Z');
  const removable = {
    lastChunkAt: { lt: cutoff },
    OR: [{ status: 'UPLOADING' }, { status: 'READY', currentOf: { is: null } }],
  };

  beforeEach(() => {
    for (const mock of [findMany, lockAvatar, deleteMany, removeQuietly]) {
      mock.mockReset();
    }
    transaction.mockClear();
    lockAvatar.mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 1 });
    removeQuietly.mockResolvedValue(true);
  });

  it('deletes abandoned and unattached avatars with the same condition, then their data', async () => {
    findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    await expect(handler.execute(new CleanupAvatarUploadsCommand(cutoff))).resolves.toBe(2);

    expect(findMany).toHaveBeenCalledWith({
      where: removable,
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', ...removable } });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'a2', ...removable } });
    expect(removeQuietly).toHaveBeenCalledWith('a1', 'abandoned avatar upload a1');
    expect(removeQuietly).toHaveBeenCalledWith('a2', 'abandoned avatar upload a2');
  });

  it('locks the avatar row before the delete, so a concurrent attachment keeps it', async () => {
    findMany.mockResolvedValue([{ id: 'a1' }]);

    await handler.execute(new CleanupAvatarUploadsCommand(cutoff));

    expect(lockAvatar).toHaveBeenCalledTimes(1);
    const [strings, id] = lockAvatar.mock.calls[0] as [TemplateStringsArray, string];
    expect(strings.join('?')).toMatch(/FOR UPDATE/);
    expect(id).toBe('a1');
    expect(lockAvatar.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('reads further batches after the last id', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `a${String(i).padStart(3, '0')}` }));
    findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([{ id: 'b' }]);

    await expect(handler.execute(new CleanupAvatarUploadsCommand(cutoff))).resolves.toBe(101);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { ...removable, id: { gt: 'a099' } } }),
    );
  });

  it('keeps the data of an avatar attached or uploading again meanwhile', async () => {
    findMany.mockResolvedValue([{ id: 'a1' }]);
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(handler.execute(new CleanupAvatarUploadsCommand(cutoff))).resolves.toBe(0);

    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('removes no data when the transaction fails', async () => {
    findMany.mockResolvedValue([{ id: 'a1' }]);
    deleteMany.mockRejectedValue(new Error('database down'));

    await expect(handler.execute(new CleanupAvatarUploadsCommand(cutoff))).rejects.toThrow(
      'database down',
    );

    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('does nothing when no avatar is removable', async () => {
    findMany.mockResolvedValue([]);

    await expect(handler.execute(new CleanupAvatarUploadsCommand(cutoff))).resolves.toBe(0);

    expect(transaction).not.toHaveBeenCalled();
  });
});

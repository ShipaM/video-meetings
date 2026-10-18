import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { ORPHAN_GRACE_MS } from '../../meeting-files.config.js';
import { SweepOrphanFilesCommand } from '../sweep-orphan-files.command.js';
import { SweepOrphanFilesHandler } from './sweep-orphan-files.handler.js';

describe('SweepOrphanFilesHandler', () => {
  const findMany = vi.fn();
  const storedEntries = vi.fn();
  const removeQuietly = vi.fn();
  const handler = new SweepOrphanFilesHandler(
    { meetingFile: { findMany } } as unknown as PrismaService,
    { storedEntries, removeQuietly } as unknown as FilesStorageService,
  );

  const olderThan = new Date('2026-01-01T12:00:00.000Z');
  const old = new Date('2026-01-01T10:00:00.000Z');
  const recent = new Date('2026-01-01T12:30:00.000Z');

  beforeEach(() => {
    findMany.mockReset();
    storedEntries.mockReset();
    removeQuietly.mockReset();
    removeQuietly.mockResolvedValue(true);
  });

  it('defaults to files older than the grace period', () => {
    const before = Date.now();
    const { olderThan: defaultOlderThan } = new SweepOrphanFilesCommand();

    expect(defaultOlderThan.getTime()).toBeGreaterThanOrEqual(before - ORPHAN_GRACE_MS);
    expect(defaultOlderThan.getTime()).toBeLessThanOrEqual(Date.now() - ORPHAN_GRACE_MS);
  });

  it('removes old files without a row only', async () => {
    storedEntries.mockResolvedValue([
      { storageKey: 'orphan', modifiedAt: old },
      { storageKey: 'known', modifiedAt: old },
      { storageKey: 'fresh', modifiedAt: recent },
    ]);
    findMany.mockResolvedValue([{ storageKey: 'known' }]);

    await expect(handler.execute(new SweepOrphanFilesCommand(olderThan))).resolves.toBe(1);

    expect(findMany).toHaveBeenCalledWith({
      where: { storageKey: { in: ['orphan', 'known'] } },
      select: { storageKey: true },
    });
    expect(removeQuietly).toHaveBeenCalledTimes(1);
    expect(removeQuietly).toHaveBeenCalledWith('orphan', 'orphan file orphan');
  });

  it('does not count a removal that failed', async () => {
    storedEntries.mockResolvedValue([{ storageKey: 'orphan', modifiedAt: old }]);
    findMany.mockResolvedValue([]);
    removeQuietly.mockResolvedValue(false);

    await expect(handler.execute(new SweepOrphanFilesCommand(olderThan))).resolves.toBe(0);
  });

  it('does not query the database when nothing is old enough', async () => {
    storedEntries.mockResolvedValue([{ storageKey: 'fresh', modifiedAt: recent }]);

    await expect(handler.execute(new SweepOrphanFilesCommand(olderThan))).resolves.toBe(0);

    expect(findMany).not.toHaveBeenCalled();
  });
});

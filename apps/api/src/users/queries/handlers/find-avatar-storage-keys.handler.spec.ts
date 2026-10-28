import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FindAvatarStorageKeysQuery } from '../find-avatar-storage-keys.query.js';
import { FindAvatarStorageKeysHandler } from './find-avatar-storage-keys.handler.js';

describe('FindAvatarStorageKeysHandler', () => {
  const findMany = vi.fn();
  const prisma = { userAvatar: { findMany } } as unknown as PrismaService;
  const handler = new FindAvatarStorageKeysHandler(prisma);

  beforeEach(() => {
    findMany.mockReset();
  });

  it('returns the keys that belong to an avatar, in one query', async () => {
    findMany.mockResolvedValue([{ id: 'a1' }]);

    await expect(handler.execute(new FindAvatarStorageKeysQuery(['a1', 'other']))).resolves.toEqual(
      ['a1'],
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'other'] } },
      select: { id: true },
    });
  });

  it('does not query the database for an empty list', async () => {
    await expect(handler.execute(new FindAvatarStorageKeysQuery([]))).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

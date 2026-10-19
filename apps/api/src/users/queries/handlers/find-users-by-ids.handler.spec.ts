import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUsersByIdsQuery } from '../find-users-by-ids.query.js';
import { FindUsersByIdsHandler } from './find-users-by-ids.handler.js';

describe('FindUsersByIdsHandler', () => {
  const findMany = vi.fn();
  const handler = new FindUsersByIdsHandler({ user: { findMany } } as unknown as PrismaService);

  beforeEach(() => {
    findMany.mockReset();
  });

  it('looks the users up in one query', async () => {
    const records = [{ id: 'u1', email: 'a@example.com' }];
    findMany.mockResolvedValue(records);

    await expect(handler.execute(new FindUsersByIdsQuery(['u1', 'u2']))).resolves.toEqual(records);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
      select: { id: true, email: true },
    });
  });

  it('does not query the database for an empty list', async () => {
    await expect(handler.execute(new FindUsersByIdsQuery([]))).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

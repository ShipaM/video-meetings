import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUserByIdQuery } from '../find-user-by-id.query.js';
import { FindUserByIdHandler } from './find-user-by-id.handler.js';

describe('FindUserByIdHandler', () => {
  const findUnique = vi.fn();
  const handler = new FindUserByIdHandler({ user: { findUnique } } as unknown as PrismaService);

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('looks the user up by id', async () => {
    const record = { id: 'u1', email: 'a@example.com', passwordHash: 'hash' };
    findUnique.mockResolvedValue(record);

    await expect(handler.execute(new FindUserByIdQuery('u1'))).resolves.toEqual(record);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
  });

  it('resolves to null when there is no such user', async () => {
    findUnique.mockResolvedValue(null);

    await expect(handler.execute(new FindUserByIdQuery('missing'))).resolves.toBeNull();
  });
});

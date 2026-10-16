import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FindUserByEmailQuery } from '../find-user-by-email.query.js';
import { FindUserByEmailHandler } from './find-user-by-email.handler.js';

describe('FindUserByEmailHandler', () => {
  const findUnique = vi.fn();
  const handler = new FindUserByEmailHandler({ user: { findUnique } } as unknown as PrismaService);

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('looks the user up by lower-cased e-mail', async () => {
    const record = { id: 'u1', email: 'a@example.com', passwordHash: 'hash' };
    findUnique.mockResolvedValue(record);

    await expect(handler.execute(new FindUserByEmailQuery('A@Example.com'))).resolves.toEqual(
      record,
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'a@example.com' } }),
    );
  });

  it('resolves to null when there is no such user', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      handler.execute(new FindUserByEmailQuery('nobody@example.com')),
    ).resolves.toBeNull();
  });
});

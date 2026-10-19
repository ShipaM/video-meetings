import type { PrismaService } from '../../../prisma/prisma.service.js';
import { ListMeetingsQuery } from '../list-meetings.query.js';
import { ListMeetingsHandler } from './list-meetings.handler.js';

describe('ListMeetingsHandler', () => {
  const findMany = vi.fn();
  const handler = new ListMeetingsHandler({ meeting: { findMany } } as unknown as PrismaService);

  beforeEach(() => {
    findMany.mockReset();
  });

  it('returns owned and shared meetings with the caller role', async () => {
    findMany.mockResolvedValue([
      { id: 'm1', ownerId: 'u1' },
      { id: 'm2', ownerId: 'u2' },
    ]);

    const result = await handler.execute(new ListMeetingsQuery('u1'));

    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ ownerId: 'u1' }, { participants: { some: { userId: 'u1' } } }] },
      orderBy: { startsAt: 'asc' },
    });
    expect(result.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: 'm1', role: 'owner' },
      { id: 'm2', role: 'participant' },
    ]);
  });
});

import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CreateUserCommand } from '../create-user.command.js';
import { CreateUserHandler } from './create-user.handler.js';

describe('CreateUserHandler', () => {
  const create = vi.fn();
  const handler = new CreateUserHandler({ user: { create } } as unknown as PrismaService);

  beforeEach(() => {
    create.mockReset();
  });

  it('stores the user with a lower-cased e-mail and returns the record', async () => {
    const record = { id: 'u1', email: 'a@example.com', passwordHash: 'hash' };
    create.mockResolvedValue(record);

    await expect(handler.execute(new CreateUserCommand('A@Example.com', 'hash'))).resolves.toEqual(
      record,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: 'a@example.com', passwordHash: 'hash' } }),
    );
  });

  it('throws ConflictException when the e-mail is already taken', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(handler.execute(new CreateUserCommand('a@example.com', 'hash'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('rethrows unexpected errors', async () => {
    create.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(new CreateUserCommand('a@example.com', 'hash'))).rejects.toThrow(
      'db down',
    );
  });
});

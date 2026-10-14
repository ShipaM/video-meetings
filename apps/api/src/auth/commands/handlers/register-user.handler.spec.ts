import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { TokenService } from '../../token.service.js';
import { RegisterUserCommand } from '../register-user.command.js';
import { RegisterUserHandler } from './register-user.handler.js';

describe('RegisterUserHandler', () => {
  const create = vi.fn<(args: { data: { email: string } }) => Promise<unknown>>();
  const issue = vi.fn().mockResolvedValue({ accessToken: 'token' });
  const handler = new RegisterUserHandler(
    { user: { create } } as unknown as PrismaService,
    { issue } as unknown as TokenService,
  );

  it('lower-cases the e-mail and returns a token', async () => {
    create.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    const result = await handler.execute(new RegisterUserCommand('A@B.com', 'Str0ngPassw0rd!'));
    expect(result).toEqual({ accessToken: 'token' });
    expect(create.mock.lastCall?.[0].data.email).toBe('a@b.com');
  });

  it('maps a unique-constraint error (P2002) to ConflictException', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' }),
    );
    await expect(
      handler.execute(new RegisterUserCommand('a@b.com', 'Str0ngPassw0rd!')),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

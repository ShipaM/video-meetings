import { UnauthorizedException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { TokenService } from '../../token.service.js';
import { LoginQuery } from '../login.query.js';
import { LoginHandler } from './login.handler.js';
describe('LoginHandler', () => {
  const findUnique = vi.fn();
  const issue = vi.fn().mockResolvedValue({ accessToken: 'token' });
  const handler = new LoginHandler(
    { user: { findUnique } } as unknown as PrismaService,
    { issue } as unknown as TokenService,
  );
  it('returns a token for valid credentials', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      passwordHash: await hash('secret123', 4),
    });
    await expect(handler.execute(new LoginQuery('A@B.com', 'secret123'))).resolves.toEqual({
      accessToken: 'token',
    });
  });
  it('rejects an unknown e-mail', async () => {
    findUnique.mockResolvedValue(null);
    await expect(handler.execute(new LoginQuery('x@y.com', 'whatever1'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('rejects a wrong password', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      passwordHash: await hash('secret123', 4),
    });
    await expect(handler.execute(new LoginQuery('a@b.com', 'wrong-pass'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

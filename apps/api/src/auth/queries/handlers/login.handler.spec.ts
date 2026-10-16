import { UnauthorizedException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { hash } from 'bcryptjs';
import { FindUserByEmailQuery } from '../../../users/index.js';
import type { TokenService } from '../../token.service.js';
import { LoginQuery } from '../login.query.js';
import { LoginHandler } from './login.handler.js';

describe('LoginHandler', () => {
  const execute = vi.fn();
  const issue = vi.fn().mockResolvedValue({ accessToken: 'token' });
  const handler = new LoginHandler(
    { execute } as unknown as QueryBus,
    { issue } as unknown as TokenService,
  );

  beforeEach(() => {
    execute.mockReset();
    issue.mockClear();
  });

  it('returns a token for valid credentials', async () => {
    execute.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      passwordHash: await hash('secret123', 4),
    });

    await expect(handler.execute(new LoginQuery('A@B.com', 'secret123'))).resolves.toEqual({
      accessToken: 'token',
    });

    const query = execute.mock.calls[0][0] as FindUserByEmailQuery;
    expect(query).toBeInstanceOf(FindUserByEmailQuery);
    expect(query.email).toBe('A@B.com');
    expect(issue).toHaveBeenCalledWith('u1', 'a@b.com');
  });

  it('rejects an unknown e-mail', async () => {
    execute.mockResolvedValue(null);

    await expect(handler.execute(new LoginQuery('x@y.com', 'whatever1'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(issue).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    execute.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      passwordHash: await hash('secret123', 4),
    });

    await expect(handler.execute(new LoginQuery('a@b.com', 'wrong-pass'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(issue).not.toHaveBeenCalled();
  });
});

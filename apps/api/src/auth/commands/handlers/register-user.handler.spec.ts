import { ConflictException } from '@nestjs/common';
import type { CommandBus } from '@nestjs/cqrs';
import { compare } from 'bcryptjs';
import { CreateUserCommand } from '../../../users/index.js';
import type { TokenService } from '../../token.service.js';
import { RegisterUserCommand } from '../register-user.command.js';
import { RegisterUserHandler } from './register-user.handler.js';

describe('RegisterUserHandler', () => {
  const execute = vi.fn();
  const issue = vi.fn();
  const handler = new RegisterUserHandler(
    { execute } as unknown as CommandBus,
    { issue } as unknown as TokenService,
  );

  beforeEach(() => {
    execute.mockReset();
    issue.mockReset();
  });

  it('creates the user through the bus with a hashed password and issues a token', async () => {
    execute.mockResolvedValue({ id: 'u1', email: 'a@example.com', passwordHash: 'ignored' });
    issue.mockResolvedValue({ accessToken: 'jwt' });

    await expect(
      handler.execute(new RegisterUserCommand('A@Example.com', 'Str0ngPassw0rd!')),
    ).resolves.toEqual({ accessToken: 'jwt' });

    const command = execute.mock.calls[0][0] as CreateUserCommand;
    expect(command).toBeInstanceOf(CreateUserCommand);
    expect(command.email).toBe('A@Example.com');
    expect(command.passwordHash).not.toBe('Str0ngPassw0rd!');
    await expect(compare('Str0ngPassw0rd!', command.passwordHash)).resolves.toBe(true);
    expect(issue).toHaveBeenCalledWith('u1', 'a@example.com');
  });

  it('does not issue a token when the user cannot be created', async () => {
    execute.mockRejectedValue(new ConflictException());

    await expect(
      handler.execute(new RegisterUserCommand('a@example.com', 'Str0ngPassw0rd!')),
    ).rejects.toThrow(ConflictException);
    expect(issue).not.toHaveBeenCalled();
  });
});

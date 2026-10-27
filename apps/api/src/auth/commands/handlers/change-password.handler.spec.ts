import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { compare, hash } from 'bcryptjs';
import { FindUserByIdQuery, UpdatePasswordHashCommand } from '../../../users/index.js';
import { ChangePasswordCommand } from '../change-password.command.js';
import { ChangePasswordHandler } from './change-password.handler.js';

describe('ChangePasswordHandler', () => {
  const queryExecute = vi.fn();
  const commandExecute = vi.fn();
  const handler = new ChangePasswordHandler(
    { execute: commandExecute } as unknown as CommandBus,
    { execute: queryExecute } as unknown as QueryBus,
  );

  const oldPassword = 'Str0ngPassw0rd!';
  const newPassword = 'N3wStr0ngPassw0rd!';

  beforeEach(() => {
    queryExecute.mockReset();
    commandExecute.mockReset();
  });

  it('stores a hash of the new password when the old one matches', async () => {
    queryExecute.mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      passwordHash: await hash(oldPassword, 4),
    });

    await expect(
      handler.execute(new ChangePasswordCommand('u1', oldPassword, newPassword)),
    ).resolves.toBeUndefined();

    const query = queryExecute.mock.calls[0][0] as FindUserByIdQuery;
    expect(query).toBeInstanceOf(FindUserByIdQuery);
    expect(query.id).toBe('u1');

    const command = commandExecute.mock.calls[0][0] as UpdatePasswordHashCommand;
    expect(command).toBeInstanceOf(UpdatePasswordHashCommand);
    expect(command.userId).toBe('u1');
    expect(command.passwordHash).not.toBe(newPassword);
    await expect(compare(newPassword, command.passwordHash)).resolves.toBe(true);
  });

  it('rejects a wrong old password with 403 and stores nothing', async () => {
    queryExecute.mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      passwordHash: await hash(oldPassword, 4),
    });

    await expect(
      handler.execute(new ChangePasswordCommand('u1', 'wrong-password', newPassword)),
    ).rejects.toThrow(ForbiddenException);
    expect(commandExecute).not.toHaveBeenCalled();
  });

  it('rejects an unknown user with 404 and stores nothing', async () => {
    queryExecute.mockResolvedValue(null);

    await expect(
      handler.execute(new ChangePasswordCommand('missing', oldPassword, newPassword)),
    ).rejects.toThrow(NotFoundException);
    expect(commandExecute).not.toHaveBeenCalled();
  });
});

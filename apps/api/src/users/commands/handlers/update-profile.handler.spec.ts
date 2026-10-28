import { ConflictException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../../storage/files-storage.service.js';
import { GetProfileQuery } from '../../queries/index.js';
import { UpdateProfileCommand } from '../update-profile.command.js';
import { UpdateProfileHandler } from './update-profile.handler.js';

describe('UpdateProfileHandler', () => {
  const lockUser = vi.fn();
  const update = vi.fn();
  const findAvatar = vi.fn();
  const deleteAvatars = vi.fn();
  const tx = {
    $queryRaw: lockUser,
    user: { update },
    userAvatar: { findUnique: findAvatar, deleteMany: deleteAvatars },
  };
  const transaction = vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const removeQuietly = vi.fn();
  const execute = vi.fn();
  const handler = new UpdateProfileHandler(
    { $transaction: transaction } as unknown as PrismaService,
    { removeQuietly } as unknown as FilesStorageService,
    { execute } as unknown as QueryBus,
  );

  const profile = { email: 'a@example.com', name: 'Ada', avatar: null };

  beforeEach(() => {
    for (const mock of [lockUser, update, findAvatar, deleteAvatars, removeQuietly, execute]) {
      mock.mockReset();
    }
    lockUser.mockResolvedValue([{ avatarId: null }]);
    findAvatar.mockResolvedValue({ userId: 'u1', status: 'READY' });
    execute.mockResolvedValue(profile);
  });

  it('saves the trimmed name and returns the profile from GetProfileQuery', async () => {
    await expect(handler.execute(new UpdateProfileCommand('u1', '  Ada  '))).resolves.toBe(profile);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Ada', avatarId: undefined },
    });
    expect(execute).toHaveBeenCalledWith(new GetProfileQuery('u1'));
  });

  it('locks the user row, so concurrent updates never miss a replaced avatar', async () => {
    await handler.execute(new UpdateProfileCommand('u1', 'Ada'));

    const [sql, ...values] = lockUser.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toMatch(/FOR UPDATE/);
    expect(values).toEqual(['u1']);
  });

  it.each(['', '   ', null])('stores null for the name %j', async (name) => {
    await handler.execute(new UpdateProfileCommand('u1', name));

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: null } }));
  });

  it('leaves the name and the avatar unchanged when they are not given', async () => {
    lockUser.mockResolvedValue([{ avatarId: 'a0' }]);

    await handler.execute(new UpdateProfileCommand('u1'));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: undefined, avatarId: undefined } }),
    );
    expect(deleteAvatars).not.toHaveBeenCalled();
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when there is no such user', async () => {
    lockUser.mockResolvedValue([]);

    await expect(handler.execute(new UpdateProfileCommand('missing', 'Ada'))).rejects.toThrow(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("sets the user's own READY avatar upload", async () => {
    await handler.execute(new UpdateProfileCommand('u1', undefined, 'a1'));

    expect(findAvatar).toHaveBeenCalledWith({
      where: { id: 'a1' },
      select: { userId: true, status: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: undefined, avatarId: 'a1' },
    });
    expect(deleteAvatars).not.toHaveBeenCalled();
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('replaces the avatar: deletes the previous row, then its data', async () => {
    lockUser.mockResolvedValue([{ avatarId: 'a0' }]);
    const order: string[] = [];
    deleteAvatars.mockImplementation(() => {
      order.push('row');
      return Promise.resolve({ count: 1 });
    });
    removeQuietly.mockImplementation(() => {
      order.push('data');
      return Promise.resolve(true);
    });

    await handler.execute(new UpdateProfileCommand('u1', undefined, 'a1'));

    expect(deleteAvatars).toHaveBeenCalledWith({ where: { id: 'a0' } });
    expect(removeQuietly).toHaveBeenCalledWith('a0', expect.any(String));
    expect(order).toEqual(['row', 'data']);
  });

  it('keeps the avatar when the current one is set again', async () => {
    lockUser.mockResolvedValue([{ avatarId: 'a1' }]);

    await handler.execute(new UpdateProfileCommand('u1', undefined, 'a1'));

    expect(deleteAvatars).not.toHaveBeenCalled();
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['foreign', { userId: 'u2', status: 'READY' }],
  ])('rejects a %s avatar upload with NotFoundException', async (_, avatar) => {
    findAvatar.mockResolvedValue(avatar);

    await expect(handler.execute(new UpdateProfileCommand('u1', 'Ada', 'a1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an unfinished avatar upload with ConflictException', async () => {
    findAvatar.mockResolvedValue({ userId: 'u1', status: 'UPLOADING' });

    await expect(handler.execute(new UpdateProfileCommand('u1', 'Ada', 'a1'))).rejects.toThrow(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('removes the avatar: clears it, deletes the row, then its data', async () => {
    lockUser.mockResolvedValue([{ avatarId: 'a0' }]);

    await handler.execute(new UpdateProfileCommand('u1', undefined, null));

    expect(findAvatar).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: undefined, avatarId: null },
    });
    expect(deleteAvatars).toHaveBeenCalledWith({ where: { id: 'a0' } });
    expect(removeQuietly).toHaveBeenCalledWith('a0', expect.any(String));
  });

  it('accepts removing when there is no avatar', async () => {
    await handler.execute(new UpdateProfileCommand('u1', undefined, null));

    expect(deleteAvatars).not.toHaveBeenCalled();
    expect(removeQuietly).not.toHaveBeenCalled();
  });

  it('removes no data when the transaction fails', async () => {
    lockUser.mockResolvedValue([{ avatarId: 'a0' }]);
    update.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(new UpdateProfileCommand('u1', undefined, null))).rejects.toThrow(
      'db down',
    );
    expect(removeQuietly).not.toHaveBeenCalled();
  });
});

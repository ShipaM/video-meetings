import { NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { DeleteMeetingFileCommand } from '../delete-meeting-file.command.js';
import { DeleteMeetingFileHandler } from './delete-meeting-file.handler.js';

describe('DeleteMeetingFileHandler', () => {
  const findFirst = vi.fn();
  const deleteMany = vi.fn();
  const execute = vi.fn();
  const remove = vi.fn();
  const handler = new DeleteMeetingFileHandler(
    { meetingFile: { findFirst, deleteMany } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    { remove } as unknown as FilesStorageService,
  );

  beforeEach(() => {
    findFirst.mockReset();
    deleteMany.mockReset();
    execute.mockReset();
    remove.mockReset();
  });

  it('checks the meeting, deletes the row and then the stored original', async () => {
    findFirst.mockResolvedValue({ storageKey: 'k1' });
    deleteMany.mockResolvedValue({ count: 1 });

    await handler.execute(new DeleteMeetingFileCommand('u1', 'm1', 'f1'));

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u1', 'm1'));
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: { not: 'UPLOADING' } },
      select: { storageKey: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'f1', meetingId: 'm1' } });
    expect(remove).toHaveBeenCalledWith('k1');
    expect(deleteMany.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
  });

  it('does not touch files of a meeting the caller cannot see (404)', async () => {
    execute.mockRejectedValue(new NotFoundException('Meeting not found'));

    await expect(handler.execute(new DeleteMeetingFileCommand('u2', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing file or an upload in progress', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new DeleteMeetingFileCommand('u1', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('answers 404 when a concurrent delete removed the row first', async () => {
    findFirst.mockResolvedValue({ storageKey: 'k1' });
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(handler.execute(new DeleteMeetingFileCommand('u1', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('still succeeds when the data cannot be removed (the file is gone for users)', async () => {
    findFirst.mockResolvedValue({ storageKey: 'k1' });
    deleteMany.mockResolvedValue({ count: 1 });
    remove.mockRejectedValue(new Error('EBUSY'));

    await expect(
      handler.execute(new DeleteMeetingFileCommand('u1', 'm1', 'f1')),
    ).resolves.toBeUndefined();
  });
});

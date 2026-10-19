import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CancelUploadCommand } from '../cancel-upload.command.js';
import { CancelUploadHandler } from './cancel-upload.handler.js';

describe('CancelUploadHandler', () => {
  const findFirst = vi.fn();
  const findUnique = vi.fn();
  const deleteMany = vi.fn();
  const execute = vi.fn();
  const handler = new CancelUploadHandler(
    { meetingFile: { findFirst, findUnique, deleteMany } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
  );

  beforeEach(() => {
    findFirst.mockReset();
    findUnique.mockReset();
    deleteMany.mockReset();
    execute.mockReset();
  });

  it("deletes the uploader's row in one query while it is UPLOADING", async () => {
    deleteMany.mockResolvedValue({ count: 1 });

    await handler.execute(new CancelUploadCommand('u1', 'f1'));

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'f1', uploadedById: 'u1', status: 'UPLOADING' },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("hides another user's upload from a stranger (404)", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({ meetingId: 'm1' });
    execute.mockRejectedValue(new NotFoundException());

    await expect(handler.execute(new CancelUploadCommand('u2', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', uploadedById: 'u2' },
      select: { id: true },
    });
    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u2', 'm1', 'manage'));
  });

  it("forbids a participant to cancel the owner's upload (403)", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({ meetingId: 'm1' });
    execute.mockRejectedValue(new ForbiddenException());

    await expect(handler.execute(new CancelUploadCommand('u3', 'f1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses to cancel a completed upload (409), so tus keeps its data', async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue({ id: 'f1' });

    await expect(handler.execute(new CancelUploadCommand('u1', 'f1'))).rejects.toThrow(
      ConflictException,
    );
  });
});

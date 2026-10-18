import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CancelUploadCommand } from '../cancel-upload.command.js';
import { CancelUploadHandler } from './cancel-upload.handler.js';

describe('CancelUploadHandler', () => {
  const findFirst = vi.fn();
  const deleteMany = vi.fn();
  const handler = new CancelUploadHandler({
    meetingFile: { findFirst, deleteMany },
  } as unknown as PrismaService);

  beforeEach(() => {
    findFirst.mockReset();
    deleteMany.mockReset();
  });

  it("deletes the uploader's row in one query while it is UPLOADING", async () => {
    deleteMany.mockResolvedValue({ count: 1 });

    await handler.execute(new CancelUploadCommand('u1', 'f1'));

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'f1', uploadedById: 'u1', status: 'UPLOADING' },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("hides another user's upload (404)", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new CancelUploadCommand('u2', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', uploadedById: 'u2' },
      select: { id: true },
    });
  });

  it('refuses to cancel a completed upload (409), so tus keeps its data', async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue({ id: 'f1' });

    await expect(handler.execute(new CancelUploadCommand('u1', 'f1'))).rejects.toThrow(
      ConflictException,
    );
  });
});

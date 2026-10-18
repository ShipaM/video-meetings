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

  it("hides another user's upload (404) and deletes nothing", async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new CancelUploadCommand('u2', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', uploadedById: 'u2' },
      select: { id: true },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the row only while the upload is UPLOADING', async () => {
    findFirst.mockResolvedValue({ id: 'f1' });
    deleteMany.mockResolvedValue({ count: 1 });

    await handler.execute(new CancelUploadCommand('u1', 'f1'));

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'f1', status: 'UPLOADING' } });
  });

  it('refuses to cancel a completed upload (409), so tus keeps its data', async () => {
    findFirst.mockResolvedValue({ id: 'f1' });
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(handler.execute(new CancelUploadCommand('u1', 'f1'))).rejects.toThrow(
      ConflictException,
    );
  });
});

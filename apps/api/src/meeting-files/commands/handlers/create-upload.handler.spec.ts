import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { CreateUploadCommand } from '../create-upload.command.js';
import { CreateUploadHandler } from './create-upload.handler.js';

describe('CreateUploadHandler', () => {
  const create = vi.fn();
  const execute = vi.fn();
  const freeBytes = vi.fn();
  const handler = new CreateUploadHandler(
    { meetingFile: { create } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    { freeBytes } as unknown as FilesStorageService,
  );

  const command = (metadata: Record<string, string | null>, size = 1024) =>
    new CreateUploadCommand('u1', 'f1', size, metadata);

  beforeEach(() => {
    create.mockReset();
    execute.mockReset();
    freeBytes.mockReset();
    execute.mockResolvedValue({ id: 'm1' });
    freeBytes.mockResolvedValue(100 * 1024 ** 3);
  });

  it('checks the meeting and stores an UPLOADING file with the resolved type', async () => {
    create.mockResolvedValue({ id: 'f1' });

    await handler.execute(
      command({ meetingId: 'm1', filename: 'C:\\fakepath\\Sync.MP4', filetype: 'video/mp4' }),
    );

    const query = execute.mock.calls[0][0] as GetMeetingQuery;
    expect(query).toBeInstanceOf(GetMeetingQuery);
    expect(query).toMatchObject({ ownerId: 'u1', id: 'm1' });
    expect(create).toHaveBeenCalledWith({
      data: {
        id: 'f1',
        meetingId: 'm1',
        uploadedById: 'u1',
        originalName: 'Sync.MP4',
        mimeType: 'video/mp4',
        kind: 'VIDEO',
        size: 1024n,
        storageKey: 'f1',
      },
    });
  });

  it('requires a meeting id and a file name', async () => {
    await expect(handler.execute(command({ filename: 'a.mp4' }))).rejects.toThrow(
      BadRequestException,
    );
    await expect(handler.execute(command({ meetingId: 'm1' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates 404 for a meeting the user does not own', async () => {
    execute.mockRejectedValue(new NotFoundException());

    await expect(
      handler.execute(command({ meetingId: 'm2', filename: 'a.mp4', filetype: 'video/mp4' })),
    ).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a type outside the allow-list', async () => {
    await expect(
      handler.execute(command({ meetingId: 'm1', filename: 'a.exe', filetype: '' })),
    ).rejects.toThrow('File type is not allowed');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an upload that does not fit on the disk (507)', async () => {
    freeBytes.mockResolvedValue(10 * 1024 ** 2);

    const error = (await handler
      .execute(command({ meetingId: 'm1', filename: 'a.mp4', filetype: 'video/mp4' }))
      .catch((e: unknown) => e)) as HttpException;
    expect(error.getStatus()).toBe(507);
    expect(create).not.toHaveBeenCalled();
  });
});

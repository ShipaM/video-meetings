import { NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { GetMeetingFileQuery } from '../get-meeting-file.query.js';
import { GetMeetingFileHandler } from './get-meeting-file.handler.js';

describe('GetMeetingFileHandler', () => {
  const findFirst = vi.fn();
  const execute = vi.fn();
  const handler = new GetMeetingFileHandler(
    { meetingFile: { findFirst } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
  );

  const file = {
    id: 'f1',
    meetingId: 'm1',
    originalName: 'notes.txt',
    mimeType: 'text/plain',
    kind: 'DOCUMENT',
    size: 42n,
    status: 'READY',
    failureReason: null,
    uploadedById: 'u1',
    storageKey: 'f1',
    createdAt: new Date(),
    completedAt: new Date(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    execute.mockResolvedValue({ id: 'm1', role: 'participant' });
  });

  it('returns the file with its summary to anyone who may view the meeting', async () => {
    findFirst.mockResolvedValue({ ...file, summary: { text: '- Ship it' } });

    const details = await handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'));

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u1', 'm1'));
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: { not: 'UPLOADING' } },
      include: { summary: true },
    });
    expect(details).toMatchObject({ id: 'f1', size: 42, summary: '- Ship it' });
    expect(details).not.toHaveProperty('storageKey');
  });

  it('gives a null summary before processing has finished', async () => {
    findFirst.mockResolvedValue({ ...file, status: 'PROCESSING', summary: null });

    await expect(handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'))).resolves.toMatchObject(
      { status: 'PROCESSING', summary: null },
    );
  });

  it('answers 404 for a missing file or an upload in progress', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

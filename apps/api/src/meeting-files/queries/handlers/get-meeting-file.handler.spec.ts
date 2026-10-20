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
    findFirst.mockResolvedValue({ ...file, summary: { text: '- Ship it' }, transcript: [] });

    const details = await handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'));

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u1', 'm1'));
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: { not: 'UPLOADING' } },
      include: { summary: true, transcript: { orderBy: { position: 'asc' } } },
    });
    expect(details).toMatchObject({ id: 'f1', size: 42, summary: '- Ship it', transcript: null });
    expect(details).not.toHaveProperty('storageKey');
  });

  it('gives a null summary before processing has finished', async () => {
    findFirst.mockResolvedValue({ ...file, status: 'PROCESSING', summary: null, transcript: [] });

    await expect(handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'))).resolves.toMatchObject(
      { status: 'PROCESSING', summary: null },
    );
  });

  it('returns the transcript and duration of a READY recording', async () => {
    findFirst.mockResolvedValue({
      ...file,
      kind: 'AUDIO',
      mimeType: 'audio/mpeg',
      durationMs: 2500,
      summary: { text: '- Ship it' },
      transcript: [
        { fileId: 'f1', position: 0, startMs: 0, endMs: 1200, text: 'Hello.' },
        { fileId: 'f1', position: 1, startMs: 1200, endMs: 2500, text: 'Ship it.' },
      ],
    });

    await expect(handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'))).resolves.toMatchObject(
      {
        durationMs: 2500,
        transcript: [
          { startMs: 0, endMs: 1200, text: 'Hello.' },
          { startMs: 1200, endMs: 2500, text: 'Ship it.' },
        ],
      },
    );
  });

  it('answers 404 for a missing file or an upload in progress', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetMeetingFileQuery('u1', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

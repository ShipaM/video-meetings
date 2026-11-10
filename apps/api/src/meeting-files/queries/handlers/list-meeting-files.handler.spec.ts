import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { ListMeetingFilesQuery } from '../list-meeting-files.query.js';
import { ListMeetingFilesHandler } from './list-meeting-files.handler.js';

describe('ListMeetingFilesHandler', () => {
  const findMany = vi.fn();
  const execute = vi.fn();
  const handler = new ListMeetingFilesHandler(
    { meetingFile: { findMany } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
  );

  const recording = {
    id: 'f1',
    meetingId: 'm1',
    originalName: 'call.mp3',
    mimeType: 'audio/mpeg',
    kind: 'AUDIO',
    size: 42n,
    status: 'READY',
    failureReason: null,
    analysisStatus: null,
    uploadedById: 'u1',
    storageKey: 'f1',
    createdAt: new Date(),
    completedAt: new Date(),
    summary: { text: '- An older summary' },
    insights: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    execute.mockResolvedValue({ id: 'm1', role: 'participant' });
  });

  it('counts the transcript segments instead of loading them', async () => {
    findMany.mockResolvedValue([]);

    await handler.execute(new ListMeetingFilesQuery('u1', 'm1'));

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u1', 'm1'));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { transcript: true } },
        }) as unknown,
      }),
    );
  });

  it('returns the analysis state of each file', async () => {
    findMany.mockResolvedValue([
      { ...recording, id: 'f1', _count: { transcript: 3 } },
      { ...recording, id: 'f2', _count: { transcript: 0 } },
      { ...recording, id: 'f3', analysisStatus: 'RUNNING', _count: { transcript: 3 } },
    ]);

    const files = await handler.execute(new ListMeetingFilesQuery('u1', 'm1'));

    expect(
      files.map(({ id, analysisStatus, canAnalyze }) => ({ id, analysisStatus, canAnalyze })),
    ).toEqual([
      { id: 'f1', analysisStatus: null, canAnalyze: true },
      { id: 'f2', analysisStatus: null, canAnalyze: false },
      { id: 'f3', analysisStatus: 'RUNNING', canAnalyze: false },
    ]);
    expect(files[0]).not.toHaveProperty('_count');
  });
});

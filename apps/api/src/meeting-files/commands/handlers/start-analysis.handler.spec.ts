import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { ProcessingQueue } from '../../processing/processing-queue.js';
import { GetMeetingFileQuery } from '../../queries/get-meeting-file.query.js';
import { StartAnalysisCommand } from '../start-analysis.command.js';
import { StartAnalysisHandler } from './start-analysis.handler.js';

describe('StartAnalysisHandler', () => {
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  const execute = vi.fn();
  const queueAnalysis = vi.fn();

  const tx = { meetingFile: { updateMany } };
  const handler = new StartAnalysisHandler(
    {
      meetingFile: { findFirst },
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    { queueAnalysis } as unknown as ProcessingQueue,
  );

  const details = { id: 'f1', status: 'READY', analysisStatus: 'RUNNING' };
  const run = () => handler.execute(new StartAnalysisCommand('u1', 'm1', 'f1'));

  beforeEach(() => {
    vi.resetAllMocks();
    execute.mockImplementation((message: unknown) =>
      Promise.resolve(message instanceof GetMeetingQuery ? { id: 'm1', role: 'owner' } : details),
    );
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('marks a READY recording with a transcript but no insights RUNNING and queues the job in the same transaction', async () => {
    await expect(run()).resolves.toBe(details);

    expect(execute).toHaveBeenNthCalledWith(1, new GetMeetingQuery('u1', 'm1', 'manage'));
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'f1',
        meetingId: 'm1',
        status: 'READY',
        kind: { in: ['AUDIO', 'VIDEO'] },
        OR: [{ analysisStatus: null }, { analysisStatus: 'FAILED' }],
        insights: { is: null },
        transcript: { some: {} },
      },
      data: { analysisStatus: 'RUNNING' },
    });
    expect(queueAnalysis).toHaveBeenCalledWith(tx, 'f1');
    // The answer is the file as the details show it: still READY, with its transcript and old summary.
    expect(execute).toHaveBeenNthCalledWith(2, new GetMeetingFileQuery('u1', 'm1', 'f1'));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('fails as a whole when the job cannot be queued (nothing is RUNNING)', async () => {
    queueAnalysis.mockRejectedValue(new Error('pg-boss down'));

    await expect(run()).rejects.toThrow('pg-boss down');
  });

  it('answers 409 for a file that cannot be analyzed and queues nothing', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue({ id: 'f1' });

    await expect(run()).rejects.toThrow(ConflictException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: { not: 'UPLOADING' } },
      select: { id: true },
    });
    expect(queueAnalysis).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing file and passes on 403 for a participant', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(NotFoundException);

    execute.mockRejectedValue(new ForbiddenException());
    updateMany.mockClear();
    await expect(run()).rejects.toThrow(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { ProcessingQueue } from '../../processing/processing-queue.js';
import { RetryFileProcessingCommand } from '../retry-file-processing.command.js';
import { RetryFileProcessingHandler } from './retry-file-processing.handler.js';

describe('RetryFileProcessingHandler', () => {
  const findFirst = vi.fn();
  const updateManyAndReturn = vi.fn();
  const execute = vi.fn();
  const queue = vi.fn();

  const tx = { meetingFile: { updateManyAndReturn } };
  const handler = new RetryFileProcessingHandler(
    {
      meetingFile: { findFirst },
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    { queue } as unknown as ProcessingQueue,
  );

  const retried = {
    id: 'f1',
    meetingId: 'm1',
    originalName: 'notes.pdf',
    mimeType: 'application/pdf',
    kind: 'DOCUMENT',
    size: 10n,
    status: 'PROCESSING',
    failureReason: null,
    uploadedById: 'u1',
    processingAttempt: 3,
    createdAt: new Date(),
    completedAt: new Date(),
  };
  const run = () => handler.execute(new RetryFileProcessingCommand('u1', 'm1', 'f1'));

  beforeEach(() => {
    vi.resetAllMocks();
    execute.mockResolvedValue({ id: 'm1', role: 'owner' });
    updateManyAndReturn.mockResolvedValue([retried]);
  });

  it('starts a new attempt of a FAILED document and queues it in the same transaction', async () => {
    await expect(run()).resolves.toMatchObject({ id: 'f1', status: 'PROCESSING', summary: null });

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u1', 'm1', 'manage'));
    expect(updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: 'FAILED', kind: 'DOCUMENT' },
      data: { status: 'PROCESSING', failureReason: null, processingAttempt: { increment: 1 } },
    });
    expect(queue).toHaveBeenCalledWith(tx, 'f1', 3);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('fails as a whole when the job cannot be queued (the file stays FAILED)', async () => {
    queue.mockRejectedValue(new Error('pg-boss down'));

    await expect(run()).rejects.toThrow('pg-boss down');
  });

  it('answers 409 for a file that cannot be retried (not FAILED, not a document)', async () => {
    updateManyAndReturn.mockResolvedValue([]);
    findFirst.mockResolvedValue({ id: 'f1' });

    await expect(run()).rejects.toThrow(ConflictException);
    expect(queue).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing file and passes on 403 for a participant', async () => {
    updateManyAndReturn.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(NotFoundException);

    execute.mockRejectedValue(new ForbiddenException());
    updateManyAndReturn.mockClear();
    await expect(run()).rejects.toThrow(ForbiddenException);
    expect(updateManyAndReturn).not.toHaveBeenCalled();
  });
});

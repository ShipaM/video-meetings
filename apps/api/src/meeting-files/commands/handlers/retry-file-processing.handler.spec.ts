import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { ProcessingQueue } from '../../processing/processing-queue.js';
import { RetryFileProcessingCommand } from '../retry-file-processing.command.js';
import { RetryFileProcessingHandler } from './retry-file-processing.handler.js';

describe('RetryFileProcessingHandler', () => {
  const findFirst = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const execute = vi.fn();
  const start = vi.fn();

  const handler = new RetryFileProcessingHandler(
    { meetingFile: { findFirst, findUnique, updateMany } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    { start } as unknown as ProcessingQueue,
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
    summary: null,
  };
  const run = () => handler.execute(new RetryFileProcessingCommand('u1', 'm1', 'f1'));

  beforeEach(() => {
    vi.resetAllMocks();
    execute.mockResolvedValue({ id: 'm1', role: 'owner' });
    findFirst.mockResolvedValue({ kind: 'DOCUMENT' });
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue(retried);
  });

  it('starts a new attempt for a FAILED document and queues it', async () => {
    await expect(run()).resolves.toMatchObject({ id: 'f1', status: 'PROCESSING', summary: null });

    expect(execute).toHaveBeenCalledWith(new GetMeetingQuery('u1', 'm1', 'manage'));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: 'FAILED' },
      data: { status: 'PROCESSING', failureReason: null, processingAttempt: { increment: 1 } },
    });
    expect(start).toHaveBeenCalledWith('f1', 3);
  });

  it('answers 409 for a file that is not FAILED (or a concurrent retry won)', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(run()).rejects.toThrow(ConflictException);
    expect(start).not.toHaveBeenCalled();
  });

  it('answers 409 for a kind that is not processed yet', async () => {
    findFirst.mockResolvedValue({ kind: 'IMAGE' });

    await expect(run()).rejects.toThrow(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing file and passes on 403 for a participant', async () => {
    findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(NotFoundException);

    execute.mockRejectedValue(new ForbiddenException());
    await expect(run()).rejects.toThrow(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

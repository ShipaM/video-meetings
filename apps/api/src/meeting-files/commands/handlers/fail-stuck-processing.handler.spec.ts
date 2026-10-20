import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { ProcessingQueue } from '../../processing/processing-queue.js';
import { FailStuckProcessingCommand } from '../fail-stuck-processing.command.js';
import { FailStuckProcessingHandler } from './fail-stuck-processing.handler.js';

describe('FailStuckProcessingHandler', () => {
  const findMany = vi.fn();
  const updateMany = vi.fn();
  const hasLiveJob = vi.fn();
  const handler = new FailStuckProcessingHandler(
    { meetingFile: { findMany, updateMany } } as unknown as PrismaService,
    { hasLiveJob } as unknown as ProcessingQueue,
  );
  const cutoff = new Date('2030-01-01T00:00:00.000Z');

  beforeEach(() => {
    vi.resetAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('fails a PROCESSING file whose job is gone, conditional on its attempt', async () => {
    findMany.mockResolvedValue([{ id: 'f1', kind: 'AUDIO', processingAttempt: 2 }]);
    hasLiveJob.mockResolvedValue(false);

    await expect(handler.execute(new FailStuckProcessingCommand(cutoff))).resolves.toBe(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      select: { id: true, kind: true, processingAttempt: true },
    });
    expect(hasLiveJob).toHaveBeenCalledWith('AUDIO', 'f1', 2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'PROCESSING', processingAttempt: 2 },
      data: { status: 'FAILED', failureReason: 'Processing was interrupted' },
    });
  });

  it('leaves a file alone while its job is still queued or running, however long', async () => {
    findMany.mockResolvedValue([{ id: 'f1', processingAttempt: 1 }]);
    hasLiveJob.mockResolvedValue(true);

    await expect(handler.execute(new FailStuckProcessingCommand(cutoff))).resolves.toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

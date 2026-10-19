import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FailStuckProcessingCommand } from '../fail-stuck-processing.command.js';
import { FailStuckProcessingHandler } from './fail-stuck-processing.handler.js';

describe('FailStuckProcessingHandler', () => {
  const updateMany = vi.fn();
  const handler = new FailStuckProcessingHandler({
    meetingFile: { updateMany },
  } as unknown as PrismaService);

  it('fails files PROCESSING without a change since the cutoff', async () => {
    updateMany.mockResolvedValue({ count: 2 });
    const cutoff = new Date('2030-01-01T00:00:00.000Z');

    await expect(handler.execute(new FailStuckProcessingCommand(cutoff))).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', failureReason: 'Processing was interrupted' },
    });
  });
});

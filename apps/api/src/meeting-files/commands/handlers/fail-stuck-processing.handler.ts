import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FAILURE_REASONS } from '../../processing/processing.config.js';
import { FailStuckProcessingCommand } from '../fail-stuck-processing.command.js';

@CommandHandler(FailStuckProcessingCommand)
export class FailStuckProcessingHandler implements ICommandHandler<FailStuckProcessingCommand> {
  private readonly logger = new Logger(FailStuckProcessingHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute({ cutoff }: FailStuckProcessingCommand): Promise<number> {
    // A job that is still alive changes the row only when it ends, so `updatedAt` is the start of
    // the attempt; the cutoff leaves room for every retry pg-boss may still make.
    const { count } = await this.prisma.meetingFile.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', failureReason: FAILURE_REASONS.interrupted },
    });
    if (count > 0) {
      this.logger.warn(`Failed ${count} file(s) stuck in PROCESSING`);
    }
    return count;
  }
}

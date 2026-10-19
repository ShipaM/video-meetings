import { Command } from '@nestjs/cqrs';
import { stuckProcessingMs } from '../processing/processing.config.js';

/**
 * Watchdog: files still `PROCESSING` with no change since `cutoff` (their job died with the
 * process and ran out of retries) end in `FAILED`; resolves to how many.
 */
export class FailStuckProcessingCommand extends Command<number> {
  constructor(public readonly cutoff: Date = new Date(Date.now() - stuckProcessingMs())) {
    super();
  }
}

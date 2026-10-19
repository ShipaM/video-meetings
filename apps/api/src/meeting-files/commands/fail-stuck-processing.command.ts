import { Command } from '@nestjs/cqrs';
import { STUCK_PROCESSING_GRACE_MS } from '../processing/processing.config.js';

/**
 * Watchdog: files `PROCESSING` (unchanged since `cutoff`) whose job is gone, i.e. it ended without
 * a result (retries used up after crashes or expirations), end in `FAILED`; resolves to how many.
 * A file still waiting in a long queue keeps its live job and is left alone.
 */
export class FailStuckProcessingCommand extends Command<number> {
  constructor(public readonly cutoff: Date = new Date(Date.now() - STUCK_PROCESSING_GRACE_MS)) {
    super();
  }
}

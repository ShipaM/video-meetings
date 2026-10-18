import { Command } from '@nestjs/cqrs';
import { ABANDONED_UPLOAD_MS } from '../meeting-files.config.js';

/**
 * Removes uploads with no chunk since `cutoff` (default: `ABANDONED_UPLOAD_MS` ago); resolves to
 * how many were removed.
 */
export class CleanupAbandonedUploadsCommand extends Command<number> {
  constructor(public readonly cutoff: Date = new Date(Date.now() - ABANDONED_UPLOAD_MS)) {
    super();
  }
}

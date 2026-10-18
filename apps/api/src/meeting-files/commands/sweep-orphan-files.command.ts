import { Command } from '@nestjs/cqrs';
import { ORPHAN_GRACE_MS } from '../meeting-files.config.js';

/**
 * Removes files on disk that have no `MeetingFile` row and were last modified before `olderThan`
 * (default: `ORPHAN_GRACE_MS` ago): data whose removal failed after its row was deleted, and files
 * of meetings deleted by a database cascade. Resolves to how many were removed.
 */
export class SweepOrphanFilesCommand extends Command<number> {
  constructor(public readonly olderThan: Date = new Date(Date.now() - ORPHAN_GRACE_MS)) {
    super();
  }
}

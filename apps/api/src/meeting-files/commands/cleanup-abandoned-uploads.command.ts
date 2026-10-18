import { Command } from '@nestjs/cqrs';

/** Removes uploads with no chunk for `ABANDONED_UPLOAD_MS`; resolves to how many were removed. */
export class CleanupAbandonedUploadsCommand extends Command<number> {}

import { Command } from '@nestjs/cqrs';

/**
 * Removes avatar uploads with no chunk since `cutoff`: abandoned `UPLOADING` uploads and `READY`
 * uploads never attached to a profile, row then data. Resolves to how many were removed.
 */
export class CleanupAvatarUploadsCommand extends Command<number> {
  constructor(public readonly cutoff: Date) {
    super();
  }
}

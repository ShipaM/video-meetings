import { Injectable } from '@nestjs/common';
import { stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { FileStore } from '@tus/file-store';
import { resolveFilesDir } from './meeting-files.config.js';

/**
 * Local disk storage of meeting files. tus writes uploads in place into `FILES_DIR/uploads/<key>`
 * (plus a `<key>.json` metadata sidecar); the completed data file stays there as the original.
 */
@Injectable()
export class FilesStorageService {
  readonly root = resolveFilesDir();
  readonly uploadsDir = path.join(this.root, 'uploads');
  readonly store = new FileStore({ directory: this.uploadsDir });

  pathOf(storageKey: string): string {
    return path.join(this.uploadsDir, storageKey);
  }

  /** Removes the data file and its tus metadata. */
  remove(storageKey: string): Promise<void> {
    return this.store.remove(storageKey);
  }

  async freeBytes(): Promise<number> {
    const { bavail, bsize } = await statfs(this.root);
    return bavail * bsize;
  }

  /** Bytes already written for a key (0 when there is no data file). */
  async storedBytes(storageKey: string): Promise<number> {
    try {
      return (await stat(this.pathOf(storageKey))).size;
    } catch {
      return 0;
    }
  }
}

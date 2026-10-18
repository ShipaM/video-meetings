import { Injectable } from '@nestjs/common';
import { rm, stat, statfs } from 'node:fs/promises';
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

  /**
   * Removes the data file and its tus metadata (`<key>.json`, the `FileStore` default). Idempotent:
   * missing files are fine, unlike `FileStore.remove`, which keeps the metadata when the data is gone.
   * Retries cover Windows, where a file still open by a download stream may be briefly busy.
   */
  async remove(storageKey: string): Promise<void> {
    const dataPath = this.pathOf(storageKey);
    await Promise.all(
      [dataPath, `${dataPath}.json`].map((file) => rm(file, { force: true, maxRetries: 3 })),
    );
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

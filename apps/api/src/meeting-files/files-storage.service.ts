import { Injectable, Logger } from '@nestjs/common';
import { readdir, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { FileStore } from '@tus/file-store';
import { resolveFilesDir } from './meeting-files.config.js';

/** Storage keys are file ids (UUIDs); anything else in the directory is not ours to remove. */
const STORED_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.json)?$/;
/** Work directories are named after their file id. */
const WORK_DIR_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Removes a data file and its tus metadata (`<key>.json`, the `FileStore` default). Idempotent:
 * missing files are fine. Retries cover Windows, where a file still open by a download stream may
 * be briefly busy.
 */
async function removeStored(dataPath: string): Promise<void> {
  await Promise.all(
    [dataPath, `${dataPath}.json`].map((file) => rm(file, { force: true, maxRetries: 3 })),
  );
}

/**
 * `FileStore` whose `remove` (tus termination, i.e. cancel) is idempotent too. The stock one throws
 * when the data file is missing and keeps the metadata.
 */
class MeetingFileStore extends FileStore {
  override remove(id: string): Promise<void> {
    return removeStored(path.join(this.directory, id));
  }
}

/** A key found on disk with the newest modification time of its data and metadata files. */
export interface StoredEntry {
  storageKey: string;
  modifiedAt: Date;
}

/** A job's work directory found on disk. */
export interface WorkDirEntry {
  fileId: string;
  modifiedAt: Date;
}

/**
 * Local disk storage of meeting files. tus writes uploads in place into `FILES_DIR/uploads/<key>`
 * (plus a `<key>.json` metadata sidecar); the completed data file stays there as the original.
 * Processing jobs keep temporary files (a recording's extracted audio) in
 * `FILES_DIR/derived/<fileId>`, removed when the job ends.
 */
@Injectable()
export class FilesStorageService {
  private readonly logger = new Logger(FilesStorageService.name);
  readonly root = resolveFilesDir();
  readonly uploadsDir = path.join(this.root, 'uploads');
  readonly derivedDir = path.join(this.root, 'derived');
  readonly store: FileStore = new MeetingFileStore({ directory: this.uploadsDir });

  pathOf(storageKey: string): string {
    return path.join(this.uploadsDir, storageKey);
  }

  /** The work directory of a processing job for the file (not created here). */
  workDirOf(fileId: string): string {
    return path.join(this.derivedDir, fileId);
  }

  /** Every work directory on disk with its modification time. */
  async workDirs(): Promise<WorkDirEntry[]> {
    const entries: WorkDirEntry[] = [];
    for (const name of await readdir(this.derivedDir).catch(() => [])) {
      if (!WORK_DIR_NAME.test(name)) {
        continue;
      }
      const modifiedAt = await stat(path.join(this.derivedDir, name)).then(
        ({ mtime }) => mtime,
        () => null,
      );
      if (modifiedAt) {
        entries.push({ fileId: name, modifiedAt });
      }
    }
    return entries;
  }

  /** Removes a work directory with everything in it; idempotent. */
  removeWorkDir(fileId: string): Promise<void> {
    return rm(this.workDirOf(fileId), { recursive: true, force: true, maxRetries: 3 });
  }

  /** Removes the data file and its tus metadata; idempotent. */
  remove(storageKey: string): Promise<void> {
    return removeStored(this.pathOf(storageKey));
  }

  /**
   * `remove` for callers that have already deleted the row: the file is gone for users either way,
   * so a failure is only logged and the orphan sweep removes the data later. Resolves to whether
   * the data is gone.
   */
  async removeQuietly(storageKey: string, what: string): Promise<boolean> {
    try {
      await this.remove(storageKey);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not remove the data of ${what}; the orphan sweep retries: ${String(error)}`,
      );
      return false;
    }
  }

  /** Every storage key that has a data or metadata file on disk. */
  async storedEntries(): Promise<StoredEntry[]> {
    const entries = new Map<string, Date>();
    for (const name of await readdir(this.uploadsDir).catch(() => [])) {
      const storageKey = STORED_NAME.exec(name)?.[1];
      if (!storageKey) {
        continue;
      }
      const modifiedAt = await stat(path.join(this.uploadsDir, name)).then(
        ({ mtime }) => mtime,
        () => null,
      );
      const known = entries.get(storageKey);
      if (modifiedAt && (!known || modifiedAt > known)) {
        entries.set(storageKey, modifiedAt);
      }
    }
    return [...entries].map(([storageKey, modifiedAt]) => ({ storageKey, modifiedAt }));
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

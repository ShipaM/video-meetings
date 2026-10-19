import { useCallback, useEffect, useRef, useState } from 'react';
import { DetailedError, Upload } from 'tus-js-client';
import { clearAccessToken, getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import {
  MAX_PARALLEL_UPLOADS,
  NOT_RETRYABLE_STATUSES,
  SESSION_EXPIRED_MESSAGE,
  UPLOAD_CHUNK_SIZE,
  UPLOAD_ERROR_MESSAGES,
  UPLOAD_RETRY_DELAYS,
} from './constants';
import { getRejectionReason } from './file-types';
import { deleteFile } from './files-api';

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  /** `rejected` never reaches the server; `done` stays until the file list has been refreshed. */
  status: 'rejected' | 'queued' | 'uploading' | 'done' | 'failed';
  /** 0..1 */
  progress: number;
  error: string | null;
  /** A failed upload that "Retry" continues from the offset the server has stored. */
  canRetry: boolean;
};

type UploadEntry = {
  file: File;
  upload: Upload;
  /** URL of the upload on the server before this `Upload` has started (set on a retry). */
  resumeUrl: string | null;
};

function getStatus(error: Error): number | undefined {
  return error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
}

/** Statuses tus may retry by itself: no answer, server errors and offset conflicts / locks. */
function isTransient(status: number): boolean {
  return status === 0 || status >= 500 || status === 409 || status === 423;
}

/** Maps a failed tus request to a message for the user. */
function getUploadError(error: Error): string {
  const status = getStatus(error);
  if (status === 400 || status === 403 || status === 404 || status === 413 || status === 507) {
    return UPLOAD_ERROR_MESSAGES[status];
  }
  if (status !== undefined && status !== 0) return UPLOAD_ERROR_MESSAGES.server;
  return navigator.onLine ? UPLOAD_ERROR_MESSAGES.network : UPLOAD_ERROR_MESSAGES.offline;
}

/**
 * Uploads files to a meeting through the API's resumable tus endpoint: checks each file against
 * the allow-list first, then runs at most `MAX_PARALLEL_UPLOADS` uploads at a time. "Retry" on a
 * failed upload continues it from the server's offset without picking the file again; "Cancel"
 * terminates it on the server, which removes the record and the partial data.
 * `onUploaded` refreshes the file list; a finished upload disappears once it resolves.
 */
export function useFileUploads(meetingId: string, onUploaded: () => Promise<void>) {
  const [items, setItems] = useState<UploadItem[]>([]);
  /** Uploads that are queued, running or may be retried; cancelled and finished ones are removed. */
  const uploads = useRef(new Map<string, UploadEntry>());
  const queue = useRef<string[]>([]);
  const running = useRef(new Set<string>());
  const nextKey = useRef(0);
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  // `startNext` and the tus callbacks refer to each other, so the latest one lives in a ref.
  const startNextRef = useRef<() => void>(() => {});

  /** Frees the slot of a running upload and starts the next queued one. */
  const finish = useCallback((key: string) => {
    if (running.current.delete(key)) startNextRef.current();
  }, []);

  /** The session ended: queued files will not start, so mark them failed instead of waiting. */
  const failQueued = useCallback(() => {
    const keys = new Set(queue.current);
    queue.current = [];
    keys.forEach((key) => uploads.current.delete(key));
    setItems((current) =>
      current.map((item) =>
        keys.has(item.key)
          ? { ...item, status: 'failed', error: SESSION_EXPIRED_MESSAGE, canRetry: false }
          : item,
      ),
    );
  }, []);

  /**
   * Terminates a cancelled upload on the server. `409` means its last chunk landed first, so it is
   * a stored file by now: delete that file too (upload id = file id), then refresh the list, which
   * shows the file only if that delete failed.
   */
  const terminate = useCallback(
    (url: string, options: Upload['options']) => {
      Upload.terminate(url, options).catch(async (error: Error) => {
        // Other failures (e.g. offline) leave the data to the server's abandoned-upload cleanup.
        if (getStatus(error) !== 409) return;
        const fileId = url.slice(url.lastIndexOf('/') + 1);
        await deleteFile(meetingId, fileId);
        await onUploadedRef.current();
      });
    },
    [meetingId],
  );

  const createUpload = useCallback(
    (key: string, file: File, uploadUrl: string | null) => {
      const upload: Upload = new Upload(file, {
        endpoint: `${API_URL}/uploads`,
        // Set on a retry: a fresh `Upload` (with a full set of automatic retries) resumes it.
        uploadUrl,
        chunkSize: UPLOAD_CHUNK_SIZE,
        retryDelays: UPLOAD_RETRY_DELAYS,
        // Resume only within this page session; after a reload the file is picked again.
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        // Read for every request, so a long upload follows a token change in another tab.
        onBeforeRequest: (request) => {
          request.setHeader('Authorization', `Bearer ${getAccessToken() ?? ''}`);
        },
        // Once cancelled, only the termination is retried, and never on `409` (stored by then).
        onShouldRetry: (error) => {
          const status = getStatus(error) ?? 0;
          const isCancelled = !uploads.current.has(key);
          if (isCancelled && (error.originalRequest?.getMethod() !== 'DELETE' || status === 409)) {
            return false;
          }
          return isTransient(status) && navigator.onLine;
        },
        metadata: { meetingId, filename: file.name, filetype: file.type },
        // Cancelled while the creation request was in flight: terminate now that the URL is known.
        onUploadUrlAvailable: () => {
          if (uploads.current.has(key) || !upload.url) return;
          void upload.abort();
          terminate(upload.url, upload.options);
          finish(key);
        },
        onProgress: (sent, total) => {
          update(key, { progress: total > 0 ? sent / total : 0 });
        },
        onError: (error) => {
          if (!uploads.current.has(key)) {
            finish(key); // cancelled while it was being created
            return;
          }
          const status = getStatus(error);
          const canRetry = status === undefined || !NOT_RETRYABLE_STATUSES.includes(status);
          const message = status === 401 ? SESSION_EXPIRED_MESSAGE : getUploadError(error);
          update(key, { status: 'failed', error: message, canRetry });
          // Nothing left to resume: the server removed what it rejected, or the session ended.
          if (!canRetry) uploads.current.delete(key);
          if (status === 401) clearAccessToken(); // expired token: back to the login page
          finish(key);
        },
        onSuccess: () => {
          const wasCancelled = !uploads.current.delete(key);
          finish(key);
          if (wasCancelled) {
            void onUploadedRef.current(); // finished before the cancel reached it: list it
            return;
          }
          update(key, { status: 'done', progress: 1 });
          void onUploadedRef.current().finally(() => removeItem(key));
        },
      });
      return upload;
    },
    [meetingId, update, removeItem, finish, terminate],
  );

  const startNext = useCallback(() => {
    if (queue.current.length > 0 && !getAccessToken()) {
      failQueued();
      clearAccessToken();
      return;
    }
    while (running.current.size < MAX_PARALLEL_UPLOADS && queue.current.length > 0) {
      const key = queue.current.shift()!;
      const entry = uploads.current.get(key);
      if (!entry) continue;
      running.current.add(key);
      update(key, { status: 'uploading', error: null });
      // On a retry tus asks the server for the stored offset (`HEAD`) and continues from there.
      entry.upload.start();
    }
  }, [update, failQueued]);

  useEffect(() => {
    startNextRef.current = startNext;
  }, [startNext]);

  // Leaving the page stops the transfers (the server keeps the partial data for its cleanup).
  useEffect(() => {
    const current = uploads.current;
    const active = running.current;
    return () => {
      active.forEach((key) => void current.get(key)?.upload.abort());
      current.clear();
      active.clear();
      queue.current = [];
    };
  }, []);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const added: UploadItem[] = [];
      for (const file of files) {
        const key = String(nextKey.current++);
        const reason = getRejectionReason(file);
        added.push({
          key,
          name: file.name,
          size: file.size,
          status: reason ? 'rejected' : 'queued',
          progress: 0,
          error: reason,
          canRetry: false,
        });
        if (!reason) {
          uploads.current.set(key, {
            file,
            upload: createUpload(key, file, null),
            resumeUrl: null,
          });
          queue.current.push(key);
        }
      }
      if (added.length === 0) return;
      setItems((current) => [...current, ...added]);
      startNext();
    },
    [createUpload, startNext],
  );

  /** Queues a failed upload again; it continues from where the server stopped receiving it. */
  const retry = useCallback(
    (key: string) => {
      const entry = uploads.current.get(key);
      if (!entry || running.current.has(key) || queue.current.includes(key)) return;
      // The failed `Upload` has used up its automatic retries; a new one starts with all of them.
      const resumeUrl = entry.upload.url ?? entry.resumeUrl;
      const upload = createUpload(key, entry.file, resumeUrl);
      uploads.current.set(key, { file: entry.file, upload, resumeUrl });
      update(key, { status: 'queued', error: null, canRetry: false });
      queue.current.push(key);
      startNext();
    },
    [createUpload, update, startNext],
  );

  /**
   * Removes an upload from the page and, if the server has it, terminates it there (the API
   * deletes the record and the partial data). Also dismisses a rejected or failed item.
   */
  const cancel = useCallback(
    (key: string) => {
      removeItem(key);
      queue.current = queue.current.filter((queued) => queued !== key);
      const entry = uploads.current.get(key);
      if (!entry) return;
      uploads.current.delete(key);

      const { upload } = entry;
      const url = upload.url ?? entry.resumeUrl;
      const isRunning = running.current.has(key);
      // Being created: aborting could leave a record on the server, so the slot stays taken
      // until the creation answers; `onUploadUrlAvailable` then terminates it, `onError` frees it.
      if (isRunning && !url) return;
      if (isRunning) void upload.abort();
      if (url) terminate(url, upload.options);
      finish(key);
    },
    [removeItem, terminate, finish],
  );

  return { items, addFiles, retry, cancel };
}

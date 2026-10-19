import { useCallback, useEffect, useRef, useState } from 'react';
import { DetailedError, Upload } from 'tus-js-client';
import { clearAccessToken, getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import {
  MAX_PARALLEL_UPLOADS,
  NOT_RETRYABLE_STATUSES,
  SESSION_EXPIRED_MESSAGE,
  UPLOAD_CHUNK_SIZE,
  UPLOAD_RETRY_DELAYS,
} from './constants';
import { getRejectionReason } from './file-types';

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

function getStatus(error: Error): number | undefined {
  return error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
}

/** Maps a failed tus request to a message for the user. */
function getUploadError(error: Error): string {
  switch (getStatus(error)) {
    case 400:
      return 'The server rejected this file: its type or content is not allowed.';
    case 404:
      return 'This meeting is no longer available.';
    case 413:
      return 'The file is larger than 2 GB.';
    case 507:
      return 'There is not enough storage space on the server.';
    default:
      return navigator.onLine
        ? 'The upload was interrupted. Check your connection and retry.'
        : 'You are offline. Retry when the connection is back.';
  }
}

/**
 * Uploads files to a meeting through the API's resumable tus endpoint: checks each file against
 * the allow-list first, then runs at most `MAX_PARALLEL_UPLOADS` uploads at a time. A failed
 * upload keeps its `Upload`, so "Retry" resumes it without picking the file again; "Cancel"
 * terminates it on the server, which removes the partial data.
 * `onUploaded` refreshes the file list; a finished upload disappears once it resolves.
 */
export function useFileUploads(meetingId: string, onUploaded: () => Promise<void>) {
  const [items, setItems] = useState<UploadItem[]>([]);
  /** Every upload that is queued, running or failed; a cancelled or finished one is removed. */
  const uploads = useRef(new Map<string, Upload>());
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
    setItems((current) =>
      current.map((item) =>
        keys.has(item.key)
          ? { ...item, status: 'failed', error: SESSION_EXPIRED_MESSAGE, canRetry: false }
          : item,
      ),
    );
  }, []);

  const createUpload = useCallback(
    (key: string, file: File) => {
      const upload: Upload = new Upload(file, {
        endpoint: `${API_URL}/uploads`,
        chunkSize: UPLOAD_CHUNK_SIZE,
        retryDelays: UPLOAD_RETRY_DELAYS,
        // Resume only within this page session; after a reload the file is picked again.
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        // Read for every request, so a long upload follows a token change in another tab.
        onBeforeRequest: (request) => {
          request.setHeader('Authorization', `Bearer ${getAccessToken() ?? ''}`);
        },
        metadata: { meetingId, filename: file.name, filetype: file.type },
        // Cancelled while the creation request was in flight: terminate now that the URL is known.
        onUploadUrlAvailable: () => {
          if (!uploads.current.has(key)) void upload.abort(true).catch(() => {});
        },
        onProgress: (sent, total) => {
          update(key, { progress: total > 0 ? sent / total : 0 });
        },
        onError: (error) => {
          if (!uploads.current.has(key)) return; // cancelled
          const status = getStatus(error);
          if (status === 401) {
            update(key, { status: 'failed', error: SESSION_EXPIRED_MESSAGE, canRetry: false });
            clearAccessToken(); // expired token: back to the login page
          } else {
            const canRetry = status === undefined || !NOT_RETRYABLE_STATUSES.includes(status);
            update(key, { status: 'failed', error: getUploadError(error), canRetry });
            // The server has removed what it rejected, nothing is left to resume or terminate.
            if (!canRetry) uploads.current.delete(key);
          }
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
    [meetingId, update, removeItem, finish],
  );

  const startNext = useCallback(() => {
    if (queue.current.length > 0 && !getAccessToken()) {
      failQueued();
      clearAccessToken();
      return;
    }
    while (running.current.size < MAX_PARALLEL_UPLOADS && queue.current.length > 0) {
      const key = queue.current.shift()!;
      const upload = uploads.current.get(key);
      if (!upload) continue;
      running.current.add(key);
      update(key, { status: 'uploading', error: null });
      // After a failure this resumes: tus asks the server for the stored offset (`HEAD`) first.
      upload.start();
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
      active.forEach((key) => void current.get(key)?.abort());
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
          uploads.current.set(key, createUpload(key, file));
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
      if (!uploads.current.has(key) || running.current.has(key) || queue.current.includes(key)) {
        return;
      }
      update(key, { status: 'queued', error: null, canRetry: false });
      queue.current.push(key);
      startNext();
    },
    [update, startNext],
  );

  /**
   * Removes an upload from the page and, if the server has it, terminates it there (the API
   * deletes the record and the partial data). Also dismisses a rejected or failed item.
   */
  const cancel = useCallback(
    (key: string) => {
      removeItem(key);
      queue.current = queue.current.filter((queued) => queued !== key);
      const upload = uploads.current.get(key);
      if (!upload) return;
      uploads.current.delete(key);
      // Without a URL the creation request may still be running; `onUploadUrlAvailable` ends it.
      if (upload.url) {
        void upload.abort(true).catch((error: Error) => {
          // 409: the last chunk landed first, so it is a stored file now (delete it from the list).
          if (getStatus(error) === 409) void onUploadedRef.current();
          // Otherwise (e.g. offline) the server's abandoned-upload cleanup removes the data.
        });
      }
      finish(key);
    },
    [removeItem, finish],
  );

  return { items, addFiles, retry, cancel };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { DetailedError, Upload } from 'tus-js-client';
import { clearAccessToken, getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import {
  MAX_PARALLEL_UPLOADS,
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
};

type QueuedFile = { key: string; file: File };

/** Maps a failed tus request to a message for the user. */
function getUploadError(error: Error): string {
  const status = error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
  switch (status) {
    case 400:
      return 'The server rejected this file: its type or content is not allowed.';
    case 404:
      return 'This meeting is no longer available.';
    case 413:
      return 'The file is larger than 2 GB.';
    case 507:
      return 'There is not enough storage space on the server.';
    default:
      return 'The upload failed. Check your connection and try again.';
  }
}

function isUnauthorized(error: Error): boolean {
  return error instanceof DetailedError && error.originalResponse?.getStatus() === 401;
}

/**
 * Uploads files to a meeting through the API's resumable tus endpoint: checks each file against
 * the allow-list first, then runs at most `MAX_PARALLEL_UPLOADS` uploads at a time.
 * `onUploaded` refreshes the file list; a finished upload disappears once it resolves.
 */
export function useFileUploads(meetingId: string, onUploaded: () => Promise<void>) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<QueuedFile[]>([]);
  const running = useRef(new Map<string, Upload>());
  const nextKey = useRef(0);
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  // `startNext` and the tus callbacks refer to each other, so the latest one lives in a ref.
  const startNextRef = useRef<() => void>(() => {});

  /** The session ended: queued files will not start, so mark them failed instead of waiting. */
  const failQueued = useCallback(() => {
    const keys = new Set(queue.current.map((queued) => queued.key));
    queue.current = [];
    setItems((current) =>
      current.map((item) =>
        keys.has(item.key) ? { ...item, status: 'failed', error: SESSION_EXPIRED_MESSAGE } : item,
      ),
    );
  }, []);

  const startNext = useCallback(() => {
    if (queue.current.length > 0 && !getAccessToken()) {
      failQueued();
      clearAccessToken();
      return;
    }
    while (running.current.size < MAX_PARALLEL_UPLOADS && queue.current.length > 0) {
      const { key, file } = queue.current.shift()!;

      const finish = () => {
        running.current.delete(key);
        startNextRef.current();
      };

      const upload = new Upload(file, {
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
        onProgress: (sent, total) => {
          update(key, { progress: total > 0 ? sent / total : 0 });
        },
        onError: (error) => {
          if (isUnauthorized(error)) {
            update(key, { status: 'failed', error: SESSION_EXPIRED_MESSAGE });
            clearAccessToken(); // expired token: back to the login page
          } else {
            update(key, { status: 'failed', error: getUploadError(error) });
          }
          finish();
        },
        onSuccess: () => {
          finish();
          update(key, { status: 'done', progress: 1 });
          void onUploadedRef.current().finally(() => remove(key));
        },
      });

      running.current.set(key, upload);
      update(key, { status: 'uploading' });
      upload.start();
    }
  }, [meetingId, update, remove, failQueued]);

  useEffect(() => {
    startNextRef.current = startNext;
  }, [startNext]);

  // Leaving the page stops the transfers (the server keeps the partial data for its cleanup).
  useEffect(() => {
    const uploads = running.current;
    return () => {
      uploads.forEach((upload) => void upload.abort());
      uploads.clear();
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
        });
        if (!reason) queue.current.push({ key, file });
      }
      if (added.length === 0) return;
      setItems((current) => [...current, ...added]);
      startNext();
    },
    [startNext],
  );

  // `dismiss` hides a rejected or failed item.
  return { items, addFiles, dismiss: remove };
}

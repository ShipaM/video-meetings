import { DetailedError, Upload } from 'tus-js-client';
import { getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import { UPLOAD_CHUNK_SIZE, UPLOAD_ERROR_MESSAGES, UPLOAD_RETRY_DELAYS } from './constants';

export function getStatus(error: Error): number | undefined {
  return error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
}

/** Statuses tus may retry by itself: no answer, server errors and offset conflicts / locks. */
function isTransient(status: number): boolean {
  return status === 0 || status >= 500 || status === 409 || status === 423;
}

/** Maps a failed tus request to a message for the user. */
export function getUploadError(error: Error): string {
  const status = getStatus(error);
  if (status === 400 || status === 403 || status === 404 || status === 413 || status === 507) {
    return UPLOAD_ERROR_MESSAGES[status];
  }
  if (status !== undefined && status !== 0) return UPLOAD_ERROR_MESSAGES.server;
  return navigator.onLine ? UPLOAD_ERROR_MESSAGES.network : UPLOAD_ERROR_MESSAGES.offline;
}

type TusUploadTarget = {
  file: File;
  meetingId: string;
  /** Set on a retry: a fresh `Upload` (with a full set of automatic retries) resumes it. */
  uploadUrl: string | null;
};

type TusUploadCallbacks = {
  isCancelled: () => boolean;
  onUploadUrlAvailable: (upload: Upload) => void;
  onProgress: (sent: number, total: number) => void;
  onError: (error: Error) => void;
  onSuccess: () => void;
};

/** A tus upload of a meeting file, not started yet. */
export function createTusUpload(
  { file, meetingId, uploadUrl }: TusUploadTarget,
  { isCancelled, onUploadUrlAvailable, onProgress, onError, onSuccess }: TusUploadCallbacks,
): Upload {
  const upload: Upload = new Upload(file, {
    endpoint: `${API_URL}/uploads`,
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
      if (isCancelled() && (error.originalRequest?.getMethod() !== 'DELETE' || status === 409)) {
        return false;
      }
      return isTransient(status) && navigator.onLine;
    },
    metadata: { meetingId, filename: file.name, filetype: file.type },
    onUploadUrlAvailable: () => onUploadUrlAvailable(upload),
    onProgress,
    onError,
    onSuccess,
  });
  return upload;
}

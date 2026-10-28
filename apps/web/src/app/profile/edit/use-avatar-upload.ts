import { useCallback, useEffect, useRef, useState } from 'react';
import { DetailedError, Upload } from 'tus-js-client';
import { clearAccessToken, getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import {
  AVATAR_CONTENT_REJECTED_MESSAGE,
  AVATAR_TOO_LARGE_MESSAGE,
  AVATAR_TYPE_REJECTED_MESSAGE,
  AVATAR_UPLOAD_FAILED_MESSAGE,
  AVATAR_UPLOAD_RETRY_DELAYS,
} from '../constants';
import { getAvatarRejectionReason } from './avatar-types';

/** What Save does with the avatar: keep the saved one, remove it, or attach a new upload. */
export type AvatarChange =
  | { type: 'keep' }
  | { type: 'remove' }
  | {
      type: 'upload';
      /** Object URL of the picked file. */
      previewUrl: string;
      /** 0..1 */
      progress: number;
      /** The tus upload id once the API has stored and checked the image, else `null`. */
      uploadId: string | null;
    };

function getStatus(error: Error): number | undefined {
  return error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
}

/** Maps a failed tus request to a message for the user. */
function getUploadError(error: Error): string {
  const status = getStatus(error);
  if (status === 400) {
    // On creation the API rejects the declared type; on completion the content does not match it.
    const isCreation =
      error instanceof DetailedError && error.originalRequest?.getMethod() === 'POST';
    return isCreation ? AVATAR_TYPE_REJECTED_MESSAGE : AVATAR_CONTENT_REJECTED_MESSAGE;
  }
  if (status === 413) return AVATAR_TOO_LARGE_MESSAGE;
  return AVATAR_UPLOAD_FAILED_MESSAGE;
}

/**
 * The avatar picked on Profile Edit: checks the file against the allow-list, then uploads it at
 * once through the API's tus endpoint (`purpose=avatar`) with progress. A failed upload falls back
 * to the saved avatar; Save attaches the finished upload (`change.uploadId`) to the profile.
 */
export function useAvatarUpload() {
  const [change, setChange] = useState<AvatarChange>({ type: 'keep' });
  const [error, setError] = useState<string | null>(null);
  /** The upload in flight; finished, failed and discarded ones are dropped. */
  const uploadRef = useRef<Upload | null>(null);
  const previewUrl = change.type === 'upload' ? change.previewUrl : null;

  useEffect(() => {
    if (previewUrl === null) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  /**
   * Stops the upload in flight and terminates it on the server, which removes its data. One still
   * being created is left running: aborting it could leave a record behind, so
   * `onUploadUrlAvailable` terminates it once the server has answered.
   */
  const discard = useCallback(() => {
    const upload = uploadRef.current;
    uploadRef.current = null;
    // A failed termination leaves the data to the server's abandoned-upload cleanup.
    if (upload?.url) upload.abort(true).catch(() => {});
  }, []);

  // Leaving the page drops the picked image (Next.js keeps the hidden page's state, so the preview
  // would show a revoked URL on return); the load on return starts from the saved avatar.
  useEffect(
    () => () => {
      discard();
      setChange({ type: 'keep' });
      setError(null);
    },
    [discard],
  );

  const pick = useCallback(
    (file: File) => {
      const reason = getAvatarRejectionReason(file);
      setError(reason);
      if (reason) return;

      discard();
      setChange({
        type: 'upload',
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        uploadId: null,
      });

      const upload: Upload = new Upload(file, {
        endpoint: `${API_URL}/uploads`,
        retryDelays: AVATAR_UPLOAD_RETRY_DELAYS,
        storeFingerprintForResuming: false,
        // Read for every request, so the upload follows a token change in another tab.
        onBeforeRequest: (request) => {
          request.setHeader('Authorization', `Bearer ${getAccessToken() ?? ''}`);
        },
        metadata: { purpose: 'avatar', filename: file.name, filetype: file.type },
        // Discarded while the creation request was in flight: terminate now that the URL is known.
        onUploadUrlAvailable: () => {
          if (uploadRef.current !== upload) upload.abort(true).catch(() => {});
        },
        onProgress: (sent, total) => {
          if (uploadRef.current !== upload) return;
          setChange((current) =>
            current.type === 'upload'
              ? { ...current, progress: total > 0 ? sent / total : 0 }
              : current,
          );
        },
        onError: (uploadError) => {
          if (uploadRef.current !== upload) return;
          uploadRef.current = null;
          // The API removed what it rejected; the saved avatar stays.
          setChange({ type: 'keep' });
          setError(getUploadError(uploadError));
          if (getStatus(uploadError) === 401) clearAccessToken(); // expired token: back to login
        },
        onSuccess: () => {
          if (uploadRef.current !== upload || !upload.url) return;
          uploadRef.current = null;
          const uploadId = upload.url.slice(upload.url.lastIndexOf('/') + 1);
          setError(null); // e.g. the request to wait for the upload
          setChange((current) =>
            current.type === 'upload' ? { ...current, progress: 1, uploadId } : current,
          );
        },
      });
      uploadRef.current = upload;
      upload.start();
    },
    [discard],
  );

  /** Save removes the avatar. */
  const remove = useCallback(() => {
    discard();
    setChange({ type: 'remove' });
    setError(null);
  }, [discard]);

  /** Back to the saved avatar, with a message (e.g. the API no longer has the upload) or none. */
  const reset = useCallback(
    (message: string | null = null) => {
      discard();
      setChange({ type: 'keep' });
      setError(message);
    },
    [discard],
  );

  const isUploading = change.type === 'upload' && change.uploadId === null;

  return { change, isUploading, error, setError, pick, remove, reset };
}

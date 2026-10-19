import type { MeetingFileKind, MeetingFileStatus } from '../../meetings';
import type { UploadItem } from './use-file-uploads';

/** 2 GiB, the PRD limit for a single file (same value as `MAX_FILE_SIZE` in the API). */
export const MAX_FILE_SIZE = 2 * 1024 ** 3;

/** Each tus `PATCH` carries at most this much, well under Node's 300 s request timeout. */
export const UPLOAD_CHUNK_SIZE = 32 * 1024 ** 2;

/** Automatic retries for short network blips before the upload is shown as failed. */
export const UPLOAD_RETRY_DELAYS = [0, 1000, 3000, 5000];

/**
 * Responses after which "Retry" cannot help: the API rejected the file (and removed what it had),
 * the meeting is gone or the session ended. Anything else, a network error included, may resume.
 */
export const NOT_RETRYABLE_STATUSES = [400, 401, 403, 404, 413];

/** Uploads running at the same time; the rest wait in the queue. */
export const MAX_PARALLEL_UPLOADS = 3;

interface AllowedType {
  extensions: string[];
  /** MIME types a browser may report for this entry (browsers are not consistent). */
  mimeTypes: string[];
}

/**
 * The allow-list from the PRD, mirroring `apps/api/src/meeting-files/file-types.ts` (no shared
 * package yet, keep both in sync). The extension is primary; a reported MIME type must agree.
 */
export const ALLOWED_TYPES: AllowedType[] = [
  { extensions: ['mp3'], mimeTypes: ['audio/mpeg', 'audio/mp3'] },
  { extensions: ['m4a'], mimeTypes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
  { extensions: ['wav'], mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  { extensions: ['webm'], mimeTypes: ['video/webm', 'audio/webm'] },
  { extensions: ['mp4'], mimeTypes: ['video/mp4'] },
  { extensions: ['mov'], mimeTypes: ['video/quicktime'] },
  { extensions: ['pdf'], mimeTypes: ['application/pdf'] },
  {
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  {
    extensions: ['pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  },
  { extensions: ['txt'], mimeTypes: ['text/plain'] },
  { extensions: ['png'], mimeTypes: ['image/png'] },
  { extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg', 'image/jpg'] },
];

/** Reported types that carry no information; the extension decides then. */
export const UNKNOWN_MIME_TYPES = ['', 'application/octet-stream'];

/** Value of the file input's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = ALLOWED_TYPES.flatMap((entry) => [
  ...entry.extensions.map((extension) => `.${extension}`),
  ...entry.mimeTypes,
]).join(',');

/** Shown in the upload area and in rejection messages. */
export const ALLOWED_TYPES_LABEL = 'MP3, M4A, WAV, WEBM, MP4, MOV, PDF, DOCX, PPTX, TXT, PNG, JPEG';

export const FILE_KIND_LABEL: Record<MeetingFileKind, string> = {
  AUDIO: 'Audio',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  IMAGE: 'Image',
};

/** Label and chip colour of a stored file's status. */
export const FILE_STATUS: Record<
  MeetingFileStatus,
  { label: string; color: 'default' | 'accent' | 'success' | 'danger' }
> = {
  UPLOADING: { label: 'Uploading', color: 'default' },
  PROCESSING: { label: 'Processing', color: 'accent' },
  READY: { label: 'Ready', color: 'success' },
  FAILED: { label: 'Failed', color: 'danger' },
};

/** Status text of an upload row. */
export const UPLOAD_STATUS_TEXT: Record<UploadItem['status'], string> = {
  rejected: 'Not uploaded',
  queued: 'Waiting…',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Upload failed',
};

/** Shown on an upload stopped because the session ended. */
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again to upload.';

/** Messages of a failed upload, by the API's answer (`network` when there was none). */
export const UPLOAD_ERROR_MESSAGES = {
  400: 'The server rejected this file: its type or content is not allowed.',
  403: 'You are not allowed to upload files to this meeting.',
  404: 'This meeting is no longer available.',
  413: 'The file is larger than 2 GB.',
  507: 'There is not enough storage space on the server.',
  server: 'The server could not take the upload. Retry in a moment.',
  network: 'The connection was interrupted. Check it and retry.',
  offline: 'You are offline. Retry when the connection is back.',
} as const;

/** Messages of the file list actions. */
export const FILE_GONE_MESSAGE = 'This file is no longer available.';
export const DOWNLOAD_FAILED_MESSAGE = 'Could not start the download. Please try again.';
export const DELETE_FAILED_MESSAGE = 'Could not delete the file. Please try again.';

/** Longest wait for the delete dialog's exit animation before the deleted row is removed anyway. */
export const DIALOG_CLOSE_FALLBACK_MS = 1000;

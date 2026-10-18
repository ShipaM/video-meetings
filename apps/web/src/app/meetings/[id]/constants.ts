/** 2 GiB, the PRD limit for a single file (same value as `MAX_FILE_SIZE` in the API). */
export const MAX_FILE_SIZE = 2 * 1024 ** 3;

/** Each tus `PATCH` carries at most this much, well under Node's 300 s request timeout. */
export const UPLOAD_CHUNK_SIZE = 32 * 1024 ** 2;

/** Automatic retries for short network blips before the upload is shown as failed. */
export const UPLOAD_RETRY_DELAYS = [0, 1000, 3000, 5000];

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

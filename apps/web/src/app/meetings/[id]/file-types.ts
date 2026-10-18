import { ALLOWED_TYPES, ALLOWED_TYPES_LABEL, MAX_FILE_SIZE, UNKNOWN_MIME_TYPES } from './constants';

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * Checks a picked file before upload. Returns the reason it is rejected, or `null` when it may be
 * uploaded. The API checks the same rules again (and the file's content on completion).
 */
export function getRejectionReason(file: File): string | null {
  const extension = getExtension(file.name);
  const mimeType = file.type.split(';')[0].trim().toLowerCase();
  const entry = ALLOWED_TYPES.find((item) => item.extensions.includes(extension));

  if (!entry || !(UNKNOWN_MIME_TYPES.includes(mimeType) || entry.mimeTypes.includes(mimeType))) {
    return `This file type is not allowed. Allowed: ${ALLOWED_TYPES_LABEL}.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'The file is larger than 2 GB.';
  }
  return null;
}

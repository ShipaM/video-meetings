import {
  AVATAR_MAX_SIZE,
  AVATAR_TOO_LARGE_MESSAGE,
  AVATAR_TYPE_REJECTED_MESSAGE,
  AVATAR_TYPES,
  AVATAR_UNKNOWN_MIME_TYPES,
} from '../constants';

/**
 * Checks a picked avatar before upload. Returns the reason it is rejected, or `null` when it may
 * be uploaded. The API checks the same rules again (and the image's content on completion).
 */
export function getAvatarRejectionReason(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const mimeType = file.type.split(';')[0].trim().toLowerCase();
  const entry = AVATAR_TYPES.find((item) => item.extensions.includes(extension));

  if (
    !entry ||
    !(AVATAR_UNKNOWN_MIME_TYPES.includes(mimeType) || entry.mimeTypes.includes(mimeType))
  ) {
    return AVATAR_TYPE_REJECTED_MESSAGE;
  }
  if (file.size > AVATAR_MAX_SIZE) {
    return AVATAR_TOO_LARGE_MESSAGE;
  }
  return null;
}

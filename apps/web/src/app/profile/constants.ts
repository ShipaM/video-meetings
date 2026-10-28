/** Mirrors `UpdateProfileDto` in the API: the limit applies to the trimmed name. */
export const PROFILE_NAME_MAX_LENGTH = 50;
export const PROFILE_NAME_TOO_LONG_MESSAGE = `Use at most ${PROFILE_NAME_MAX_LENGTH} characters`;
export const PROFILE_NAME_HINT = `Up to ${PROFILE_NAME_MAX_LENGTH} characters. Leave it empty to show your e-mail instead.`;
export const PROFILE_LOAD_FAILED_MESSAGE = 'Could not load your profile.';
export const PROFILE_SAVE_FAILED_MESSAGE = 'Could not save your profile. Please try again.';
export const PROFILE_NAME_REJECTED_MESSAGE = 'The server rejected this name.';
/** 5 MiB, mirrors `MAX_AVATAR_SIZE` in `apps/api/src/users/avatar-types.ts`. */
export const AVATAR_MAX_SIZE = 5 * 1024 ** 2;

interface AvatarType {
  extensions: string[];
  /** MIME types a browser may report for this entry (browsers are not consistent). */
  mimeTypes: string[];
}

/**
 * The avatar allow-list, mirroring `apps/api/src/users/avatar-types.ts` (no shared package yet,
 * keep both in sync). The extension is primary; a reported MIME type must agree.
 */
export const AVATAR_TYPES: AvatarType[] = [
  { extensions: ['png'], mimeTypes: ['image/png'] },
  { extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg', 'image/jpg'] },
  { extensions: ['webp'], mimeTypes: ['image/webp'] },
];

/** Reported types that carry no information; the extension decides then. */
export const AVATAR_UNKNOWN_MIME_TYPES = ['', 'application/octet-stream'];

/** Value of the avatar input's `accept` attribute. */
export const AVATAR_ACCEPT_ATTRIBUTE = AVATAR_TYPES.flatMap((entry) => [
  ...entry.extensions.map((extension) => `.${extension}`),
  ...entry.mimeTypes,
]).join(',');

// A no-break space keeps "5 MB" on one line.
export const AVATAR_HINT = 'PNG, JPEG or WebP, up to 5 MB.';
export const AVATAR_TYPE_REJECTED_MESSAGE =
  'This file type is not allowed. Choose a PNG, JPEG or WebP image.';
export const AVATAR_TOO_LARGE_MESSAGE = 'The image is larger than 5 MB.';
export const AVATAR_CONTENT_REJECTED_MESSAGE =
  'The server rejected this image: its content is not a PNG, JPEG or WebP image.';
export const AVATAR_UPLOAD_FAILED_MESSAGE = 'Could not upload the image. Please try again.';
export const AVATAR_UPLOAD_GONE_MESSAGE =
  'The uploaded image is no longer available. Choose it again.';
export const AVATAR_UPLOADING_MESSAGE = 'Wait until the image has been uploaded.';
/** Automatic retries for short network blips before the upload is shown as failed. */
export const AVATAR_UPLOAD_RETRY_DELAYS = [0, 1000, 3000, 5000];
/** Id of the change password form on `/profile/edit`, the target of the action on `/profile`. */
export const CHANGE_PASSWORD_SECTION_ID = 'change-password';
export const OLD_PASSWORD_MISSING_MESSAGE = 'Enter your current password';
export const OLD_PASSWORD_WRONG_MESSAGE = 'The current password is wrong';
export const NEW_PASSWORD_MISSING_MESSAGE = 'Enter a new password';
export const CONFIRM_PASSWORD_MISSING_MESSAGE = 'Repeat the new password';
export const CONFIRM_PASSWORD_MISMATCH_MESSAGE = 'The passwords do not match';
export const NEW_PASSWORD_REJECTED_MESSAGE = 'The server rejected this password.';
export const PASSWORD_CHANGE_FAILED_MESSAGE = 'Could not change your password. Please try again.';
export const PASSWORD_CHANGED_MESSAGE = 'Your password has been changed.';

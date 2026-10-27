/** Mirrors `UpdateProfileDto` in the API: the limit applies to the trimmed name. */
export const PROFILE_NAME_MAX_LENGTH = 50;
export const PROFILE_NAME_TOO_LONG_MESSAGE = `Use at most ${PROFILE_NAME_MAX_LENGTH} characters`;
export const PROFILE_NAME_HINT = `Up to ${PROFILE_NAME_MAX_LENGTH} characters. Leave it empty to show your e-mail instead.`;
export const PROFILE_LOAD_FAILED_MESSAGE = 'Could not load your profile.';
export const PROFILE_SAVE_FAILED_MESSAGE = 'Could not save your profile. Please try again.';
export const PROFILE_NAME_REJECTED_MESSAGE = 'The server rejected this name.';
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

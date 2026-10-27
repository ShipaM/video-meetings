/** Mirrors `UpdateProfileDto` in the API: the limit applies to the trimmed name. */
export const PROFILE_NAME_MAX_LENGTH = 50;
export const PROFILE_NAME_TOO_LONG_MESSAGE = `Use at most ${PROFILE_NAME_MAX_LENGTH} characters`;
export const PROFILE_NAME_HINT = `Up to ${PROFILE_NAME_MAX_LENGTH} characters. Leave it empty to show your e-mail instead.`;
export const PROFILE_LOAD_FAILED_MESSAGE = 'Could not load your profile.';
export const PROFILE_SAVE_FAILED_MESSAGE = 'Could not save your profile. Please try again.';
export const PROFILE_NAME_REJECTED_MESSAGE = 'The server rejected this name.';
/** Id of the change password form on `/profile/edit`, the target of the action on `/profile`. */
export const CHANGE_PASSWORD_SECTION_ID = 'change-password';

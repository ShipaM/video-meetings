import { authorizedFetch, readErrorMessage } from '../../api';
import { SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import type { Profile } from '../../profile';
import {
  PROFILE_LOAD_FAILED_MESSAGE,
  PROFILE_NAME_REJECTED_MESSAGE,
  PROFILE_SAVE_FAILED_MESSAGE,
} from '../constants';
import type { AvatarChange } from './use-avatar-upload';

export type ProfileLoadResult =
  | { type: 'profile'; profile: Profile }
  | { type: 'unauthorized' }
  | { type: 'error'; message: string };

/** Rejects only when `signal` aborts. */
export async function fetchProfile(signal: AbortSignal): Promise<ProfileLoadResult> {
  try {
    const response = await authorizedFetch('/users/me', { signal });
    if (!response) return { type: 'unauthorized' };
    if (!response.ok) return { type: 'error', message: PROFILE_LOAD_FAILED_MESSAGE };
    return { type: 'profile', profile: (await response.json()) as Profile };
  } catch (error) {
    if (signal.aborted) throw error;
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

export type ProfileSaveResult =
  | { type: 'saved' }
  | { type: 'unauthorized' }
  | { type: 'name-rejected'; message: string }
  | { type: 'upload-gone' }
  | { type: 'error'; message: string };

/** Rejects only when `signal` aborts. */
export async function saveProfile(
  name: string,
  change: AvatarChange,
  signal: AbortSignal,
): Promise<ProfileSaveResult> {
  try {
    // An empty name clears it; the API trims as well.
    const response = await authorizedFetch('/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        ...(change.type === 'upload' && { avatarUploadId: change.uploadId }),
        ...(change.type === 'remove' && { avatar: null }),
      }),
      signal,
    });
    if (!response) return { type: 'unauthorized' };
    if (response.status === 400) {
      return {
        type: 'name-rejected',
        message: (await readErrorMessage(response)) ?? PROFILE_NAME_REJECTED_MESSAGE,
      };
    }
    // The upload is gone (e.g. removed by the cleanup) or unfinished: the saved avatar stays.
    if (change.type === 'upload' && (response.status === 404 || response.status === 409)) {
      return { type: 'upload-gone' };
    }
    if (!response.ok) return { type: 'error', message: PROFILE_SAVE_FAILED_MESSAGE };
    return { type: 'saved' };
  } catch (error) {
    if (signal.aborted) throw error;
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

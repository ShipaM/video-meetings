import { authorizedFetch, readErrorMessage } from '../../api';
import { SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import {
  NEW_PASSWORD_REJECTED_MESSAGE,
  OLD_PASSWORD_WRONG_MESSAGE,
  PASSWORD_CHANGE_FAILED_MESSAGE,
} from '../constants';

export type ChangePasswordResult =
  | { type: 'changed' }
  | { type: 'unauthorized' }
  | { type: 'old-password-rejected'; message: string }
  | { type: 'new-password-rejected'; message: string }
  | { type: 'error'; message: string };

export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  try {
    const response = await authorizedFetch('/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    if (!response) return { type: 'unauthorized' };
    if (response.status === 403) {
      return { type: 'old-password-rejected', message: OLD_PASSWORD_WRONG_MESSAGE };
    }
    if (response.status === 400) {
      return {
        type: 'new-password-rejected',
        message: (await readErrorMessage(response)) ?? NEW_PASSWORD_REJECTED_MESSAGE,
      };
    }
    if (!response.ok) return { type: 'error', message: PASSWORD_CHANGE_FAILED_MESSAGE };
    return { type: 'changed' };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

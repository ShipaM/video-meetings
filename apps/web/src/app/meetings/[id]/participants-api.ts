import { authorizedFetch } from '../../api';
import { SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import type { Participant } from '../../meetings';
import type { RemovalResult } from './use-confirmed-removal';
import {
  MEETING_GONE_MESSAGE,
  MEETING_NOT_FOUND_API_MESSAGE,
  PARTICIPANT_ADD_ERROR_MESSAGES,
  PARTICIPANT_ADD_FAILED_MESSAGE,
  PARTICIPANT_REMOVE_FAILED_MESSAGE,
  PARTICIPANTS_LOAD_FAILED_MESSAGE,
} from './constants';

export type ParticipantsResult =
  | { type: 'participants'; participants: Participant[] }
  | { type: 'unauthorized' }
  | { type: 'error'; message: string };

/** Lists the participants of a meeting (owner only), oldest first. */
export async function listParticipants(
  meetingId: string,
  signal?: AbortSignal,
): Promise<ParticipantsResult> {
  try {
    const response = await authorizedFetch(`/meetings/${meetingId}/participants`, { signal });
    if (!response) return { type: 'unauthorized' };
    if (!response.ok) return { type: 'error', message: PARTICIPANTS_LOAD_FAILED_MESSAGE };
    return { type: 'participants', participants: (await response.json()) as Participant[] };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

export type AddParticipantResult =
  | { type: 'added'; participant: Participant }
  | { type: 'unauthorized' }
  | { type: 'error'; message: string };

/** The API's own message for a rejected add (a string, not a validation list), if any. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const { message } = (await response.json()) as { message?: unknown };
    return typeof message === 'string' && message ? message : null;
  } catch {
    return null;
  }
}

/**
 * Shares the meeting with the registered user who has this e-mail. A rejection carries the API's
 * reason: unregistered e-mail (`404`), the owner's own e-mail (`400`), already a participant (`409`).
 */
export async function addParticipant(
  meetingId: string,
  email: string,
): Promise<AddParticipantResult> {
  try {
    const response = await authorizedFetch(`/meetings/${meetingId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response) return { type: 'unauthorized' };
    if (response.ok) {
      return { type: 'added', participant: (await response.json()) as Participant };
    }
    const fallback = PARTICIPANT_ADD_ERROR_MESSAGES[response.status];
    if (fallback === undefined) return { type: 'error', message: PARTICIPANT_ADD_FAILED_MESSAGE };
    return { type: 'error', message: (await readErrorMessage(response)) ?? fallback };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

/** Ends a participant's access; one who is already gone counts as removed, a gone meeting not. */
export async function removeParticipant(meetingId: string, userId: string): Promise<RemovalResult> {
  try {
    const response = await authorizedFetch(`/meetings/${meetingId}/participants/${userId}`, {
      method: 'DELETE',
    });
    if (!response) return { type: 'unauthorized' };
    if (response.ok) return { type: 'removed' };
    if (response.status === 404) {
      // `404` is either the participant (already gone: removed) or the meeting itself.
      return (await readErrorMessage(response)) === MEETING_NOT_FOUND_API_MESSAGE
        ? { type: 'error', message: MEETING_GONE_MESSAGE }
        : { type: 'removed' };
    }
    return { type: 'error', message: PARTICIPANT_REMOVE_FAILED_MESSAGE };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

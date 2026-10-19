import { authorizedFetch } from '../../api';
import { API_URL, SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import type { MeetingFile } from '../../meetings';
import { DELETE_FAILED_MESSAGE, DOWNLOAD_FAILED_MESSAGE, FILE_GONE_MESSAGE } from './constants';

/**
 * Asks the API for a short-lived signed link and lets the browser download it. Resolves to an
 * error message, or `null` when the download started (or the session ended).
 */
export async function downloadFile(file: MeetingFile): Promise<string | null> {
  try {
    const response = await authorizedFetch(`/meetings/${file.meetingId}/files/${file.id}/link`, {
      method: 'POST',
    });
    if (!response) return null;
    if (response.status === 404) return FILE_GONE_MESSAGE;
    if (!response.ok) return DOWNLOAD_FAILED_MESSAGE;

    const { url } = (await response.json()) as { url: string };
    // The response is `Content-Disposition: attachment`, so the page stays where it is.
    const link = document.createElement('a');
    link.href = `${API_URL}${url}`;
    link.rel = 'noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
    return null;
  } catch {
    return SERVER_UNAVAILABLE_MESSAGE;
  }
}

export type DeleteResult =
  { type: 'deleted' } | { type: 'unauthorized' } | { type: 'error'; message: string };

/** Deletes a stored file and its record; a file that is already gone counts as deleted. */
export async function deleteFile(meetingId: string, fileId: string): Promise<DeleteResult> {
  try {
    const response = await authorizedFetch(`/meetings/${meetingId}/files/${fileId}`, {
      method: 'DELETE',
    });
    if (!response) return { type: 'unauthorized' };
    if (response.ok || response.status === 404) return { type: 'deleted' };
    return { type: 'error', message: DELETE_FAILED_MESSAGE };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

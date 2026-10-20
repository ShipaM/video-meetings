import { authorizedFetch } from '../../api';
import { API_URL, SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import type { MeetingFile } from '../../meetings';
import type { RemovalResult } from './use-confirmed-removal';
import {
  DELETE_FAILED_MESSAGE,
  DOWNLOAD_FAILED_MESSAGE,
  FILE_GONE_MESSAGE,
  RETRY_CONFLICT_MESSAGE,
  RETRY_FAILED_MESSAGE,
} from './constants';

/** A short-lived signed link to a file's content: an absolute URL and when it arrived. */
export type FileLink = {
  url: string;
  /** `performance.now()` when the link arrived; its age decides whether it may be reused. */
  receivedAt: number;
};

export type FileLinkResult =
  { type: 'link'; link: FileLink } | { type: 'error'; message: string } | { type: 'unauthorized' };

/** Asks the API for a short-lived signed link to the file (download, preview). */
export async function requestFileLink(
  file: Pick<MeetingFile, 'id' | 'meetingId'>,
  failedMessage = DOWNLOAD_FAILED_MESSAGE,
): Promise<FileLinkResult> {
  try {
    const response = await authorizedFetch(`/meetings/${file.meetingId}/files/${file.id}/link`, {
      method: 'POST',
    });
    if (!response) return { type: 'unauthorized' };
    if (response.status === 404) return { type: 'error', message: FILE_GONE_MESSAGE };
    if (!response.ok) return { type: 'error', message: failedMessage };

    const { url } = (await response.json()) as { url: string };
    return { type: 'link', link: { url: `${API_URL}${url}`, receivedAt: performance.now() } };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

/** The link's URL served inline (PDF, PNG, JPEG), for an `<img>` or `<iframe>` preview. */
export function inlineUrl(link: FileLink): string {
  return `${link.url}&disposition=inline`;
}

/**
 * Asks the API for a short-lived signed link and lets the browser download it. Resolves to an
 * error message, or `null` when the download started (or the session ended).
 */
export async function downloadFile(file: MeetingFile): Promise<string | null> {
  const result = await requestFileLink(file);
  if (result.type === 'error') return result.message;
  if (result.type === 'unauthorized') return null;

  // The response is `Content-Disposition: attachment`, so the page stays where it is.
  const link = document.createElement('a');
  link.href = result.link.url;
  link.rel = 'noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  return null;
}

export type RetryResult =
  | { type: 'retried'; file: MeetingFile }
  /** The file changed meanwhile (`409`) or is gone (`404`): the list should be reloaded. */
  | { type: 'stale'; message: string }
  | { type: 'error'; message: string }
  | { type: 'unauthorized' };

/** Processes a `FAILED` file again (owner only); on success the file is `PROCESSING`. */
export async function retryProcessing(file: MeetingFile): Promise<RetryResult> {
  try {
    const response = await authorizedFetch(`/meetings/${file.meetingId}/files/${file.id}/retry`, {
      method: 'POST',
    });
    if (!response) return { type: 'unauthorized' };
    if (response.status === 409) return { type: 'stale', message: RETRY_CONFLICT_MESSAGE };
    if (response.status === 404) return { type: 'stale', message: FILE_GONE_MESSAGE };
    if (!response.ok) return { type: 'error', message: RETRY_FAILED_MESSAGE };
    return { type: 'retried', file: (await response.json()) as MeetingFile };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

/** Deletes a stored file and its record; a file that is already gone counts as deleted. */
export async function deleteFile(meetingId: string, fileId: string): Promise<RemovalResult> {
  try {
    const response = await authorizedFetch(`/meetings/${meetingId}/files/${fileId}`, {
      method: 'DELETE',
    });
    if (!response) return { type: 'unauthorized' };
    if (response.ok || response.status === 404) return { type: 'removed' };
    return { type: 'error', message: DELETE_FAILED_MESSAGE };
  } catch {
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

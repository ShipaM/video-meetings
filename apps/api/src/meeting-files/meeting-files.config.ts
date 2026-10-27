/** 2 GiB, the PRD limit for a single file. */
export const MAX_FILE_SIZE = 2 * 1024 ** 3;

/** Lifetime of a signed link to a document or an image: the request starts at once. */
export const FILE_LINK_TTL_SECONDS = 5 * 60;

/**
 * Lifetime of a signed link to a recording: a player asks for new byte ranges whenever the user
 * seeks, long after the page opened, so the link lives for the recording plus 30 minutes (an hour
 * when the duration is not known yet), at most 6 hours.
 */
export function mediaLinkTtlSeconds(durationMs: number | null): number {
  const playSeconds = durationMs === null ? 30 * 60 : Math.ceil(durationMs / 1000);
  return Math.min(playSeconds + 30 * 60, 6 * 60 * 60);
}

/**
 * Stored types a link may serve inline (`?disposition=inline`) for a preview in the page; every
 * other type is always an attachment, so no uploaded content is ever rendered by the browser.
 */
export const INLINE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Stored recording types a link may also serve inline, for the page's audio and video player;
 * unlike a preview they keep byte ranges, so the player can seek and stream.
 */
export const PLAYABLE_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

/** JWT audience of file links, so an access token can never be used as a link and vice versa. */
export const FILE_LINK_AUDIENCE = 'file-content';

/** Secret for file links (`FILE_LINK_SECRET`), separate from `JWT_SECRET`. */
export function fileLinkSecret(): string {
  const secret = process.env.FILE_LINK_SECRET;
  if (!secret) {
    throw new Error('FILE_LINK_SECRET is not set');
  }
  return secret;
}

/** An upload with no chunk for this long counts as abandoned (PRD: 24 hours after the last part). */
export const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** When storage maintenance runs (cron, hourly): abandoned uploads, orphan files, stuck files. */
export const STORAGE_MAINTENANCE_CRON = '0 * * * *';

/**
 * A file on disk without a `MeetingFile` row is removed only once it is this old. The row is
 * created before tus writes the file, so this is only a safety margin for removals in progress.
 */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/** `FILES_CLEANUP=off` disables the scheduled maintenance (e2e tests share the dev database). */
export function filesCleanupEnabled(): boolean {
  return process.env.FILES_CLEANUP !== 'off';
}

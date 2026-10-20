import { FILE_SIZE_UNITS } from './constants';

/** The caller's relation to a meeting: `participant` means it was shared with them (read-only). */
export type MeetingRole = 'owner' | 'participant';

export type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  ownerId: string;
  role: MeetingRole;
  createdAt: string;
};

/** A participant as returned by `GET /meetings/:id/participants`. */
export type Participant = {
  userId: string;
  email: string;
  addedAt: string;
};

export type MeetingFileStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export type MeetingFileKind = 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'IMAGE';

/** A meeting file as returned by `GET /meetings/:id/files` (and its details route). */
export type MeetingFile = {
  id: string;
  meetingId: string;
  originalName: string;
  mimeType: string;
  kind: MeetingFileKind;
  size: number;
  status: MeetingFileStatus;
  /** Short reason of a `FAILED` file, `null` otherwise. */
  failureReason: string | null;
  /** The API serves it inline (PDF, PNG, JPEG), so the page can preview it. */
  previewable: boolean;
  /** The API serves it inline with byte ranges (audio, video), so the page can play it. */
  playable: boolean;
  /** Length of a recording once the API has probed it, `null` otherwise. */
  durationMs: number | null;
  /** Summary of a `READY` document or recording, `null` before, on failure and for images. */
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** A timed piece of a recording's transcript. */
export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

/** A file as returned by its details route `GET /meetings/:id/files/:fileId`. */
export type MeetingFileDetails = MeetingFile & {
  /** The transcript of a `READY` recording, `null` otherwise (or for one without segments). */
  transcript: TranscriptSegment[] | null;
};

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function formatMeetingDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** Rounds `value` for display in `unit`; GB rounds up so a size over a limit never reads as it. */
function roundSize(value: number, unit: number): { value: number; digits: number } {
  const isGb = FILE_SIZE_UNITS[unit] === 'GB';
  const digits = unit === 0 || Math.round(value * 10) / 10 >= 100 ? 0 : isGb ? 2 : 1;
  const factor = 10 ** digits;
  const scaled = value * factor;
  return { value: (isGb ? Math.ceil(scaled) : Math.round(scaled)) / factor, digits };
}

/** Human-readable size in binary units (1 KB = 1024 B), e.g. `1.5 MB`. */
export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  // Move up a unit when rounding would print 1024 or more, e.g. 1,048,575 B is `1.0 MB`.
  while (unit < FILE_SIZE_UNITS.length - 1 && roundSize(value, unit).value >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const rounded = roundSize(value, unit);
  return `${rounded.value.toFixed(rounded.digits)} ${FILE_SIZE_UNITS[unit]}`;
}

/** A media position or length as `m:ss`, or `h:mm:ss` from an hour on, e.g. `3:07`. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

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

/** A meeting file as returned by `GET /meetings/:id/files`. */
export type MeetingFile = {
  id: string;
  meetingId: string;
  originalName: string;
  mimeType: string;
  kind: MeetingFileKind;
  size: number;
  status: MeetingFileStatus;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
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

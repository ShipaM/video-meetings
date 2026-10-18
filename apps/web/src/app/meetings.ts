export type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  createdAt: string;
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

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** Human-readable size in binary units (1 KB = 1024 B), e.g. `1.5 MB`. */
export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Two decimals for GB, so a file just over the 2 GB limit does not read as "2.0 GB".
  const digits = unit === 0 || value >= 100 ? 0 : SIZE_UNITS[unit] === 'GB' ? 2 : 1;
  return `${value.toFixed(digits)} ${SIZE_UNITS[unit]}`;
}

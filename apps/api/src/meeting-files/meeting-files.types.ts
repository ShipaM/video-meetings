import type { MeetingFile, TranscriptSegment } from '../generated/prisma/client.js';
import type { MeetingFileKind, MeetingFileStatus } from '../generated/prisma/enums.js';
import { isRecording } from './file-types.js';
import { INLINE_MIME_TYPES, PLAYABLE_MIME_TYPES } from './meeting-files.config.js';

/** A meeting file as returned by the API (the storage key stays internal). */
export interface MeetingFileView {
  id: string;
  meetingId: string;
  originalName: string;
  mimeType: string;
  kind: MeetingFileKind;
  /** Bytes; a number is exact up to 2^53, far above the 2 GiB limit. */
  size: number;
  status: MeetingFileStatus;
  failureReason: string | null;
  /**
   * Whether a link serves the file inline (`disposition=inline`) as a whole, so a page can preview
   * it (PDF, PNG, JPEG).
   */
  previewable: boolean;
  /**
   * Whether a link serves the file inline with byte ranges, for the page's audio or video player.
   */
  playable: boolean;
  /** Length of a recording once its processing has probed it, else `null`. */
  durationMs: number | null;
  uploadedById: string;
  createdAt: Date;
  completedAt: Date | null;
}

export const toMeetingFileView = (file: MeetingFile): MeetingFileView => ({
  id: file.id,
  meetingId: file.meetingId,
  originalName: file.originalName,
  mimeType: file.mimeType,
  kind: file.kind,
  size: Number(file.size),
  status: file.status,
  failureReason: file.failureReason,
  previewable: INLINE_MIME_TYPES.includes(file.mimeType),
  playable: PLAYABLE_MIME_TYPES.includes(file.mimeType),
  durationMs: file.durationMs,
  uploadedById: file.uploadedById,
  createdAt: file.createdAt,
  completedAt: file.completedAt,
});

/** A file with its summary, as listed (`GET /meetings/:id/files`). */
export interface MeetingFileListItem extends MeetingFileView {
  /** Set once a document or a recording is `READY`; `null` before, on failure and for images. */
  summary: string | null;
}

export const toMeetingFileListItem = (
  file: MeetingFile & { summary: { text: string } | null },
): MeetingFileListItem => ({ ...toMeetingFileView(file), summary: file.summary?.text ?? null });

/** A timed piece of a recording's transcript. */
export interface TranscriptSegmentView {
  startMs: number;
  endMs: number;
  text: string;
}

/** A file with all results of its processing (`GET /meetings/:id/files/:fileId`). */
export interface MeetingFileDetails extends MeetingFileListItem {
  /**
   * The transcript once a recording is `READY` (in the order of `file.transcript`, which the query
   * sorts by position); `null` before, on failure and for other kinds. Only in the details: a long
   * meeting has thousands of segments.
   */
  transcript: TranscriptSegmentView[] | null;
}

export const toMeetingFileDetails = (
  file: MeetingFile & { summary: { text: string } | null; transcript: TranscriptSegment[] },
): MeetingFileDetails => ({
  ...toMeetingFileListItem(file),
  // Segments are kept after a failed summary (for the retry), so READY decides.
  transcript:
    file.status === 'READY' && isRecording(file.kind) && file.transcript.length > 0
      ? file.transcript.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))
      : null,
});

/** A signed link to `GET /files/:fileId/content`, relative to the API base URL. */
export interface FileLink {
  url: string;
  expiresAt: Date;
}

/** Payload of a file link token. */
export interface FileLinkPayload {
  sub: string;
  fileId: string;
}

/** What the content route needs to stream a file. */
export interface FileContent {
  path: string;
  originalName: string;
  mimeType: string;
}

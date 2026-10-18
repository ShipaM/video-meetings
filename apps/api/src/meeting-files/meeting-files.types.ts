import type { MeetingFile } from '../generated/prisma/client.js';
import type { MeetingFileKind, MeetingFileStatus } from '../generated/prisma/enums.js';

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
  uploadedById: file.uploadedById,
  createdAt: file.createdAt,
  completedAt: file.completedAt,
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

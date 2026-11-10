import type {
  ActionItem,
  MeetingDecision,
  MeetingFile,
  RecordingInsights,
  TranscriptSegment,
} from '../generated/prisma/client.js';
import type {
  AnalysisStatus,
  MeetingFileKind,
  MeetingFileStatus,
  RecordingStage,
} from '../generated/prisma/enums.js';
import { isRecording } from './file-types.js';
import { INLINE_MIME_TYPES, PLAYABLE_MIME_TYPES } from './meeting-files.config.js';
import type { ActionItemInsight, DecisionInsight } from './processing/meeting-analyzer.js';

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
  /** How far a recording in `PROCESSING` has come; `null` for any other file. */
  processingStage: RecordingStage | null;
  /**
   * The manual analysis of a `READY` recording: `RUNNING`, `FAILED`, or `null` when none was
   * started or it succeeded. The file stays `READY` meanwhile.
   */
  analysisStatus: AnalysisStatus | null;
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
  processingStage:
    file.status === 'PROCESSING' && isRecording(file.kind) ? file.processingStage : null,
  analysisStatus: file.analysisStatus,
  previewable: INLINE_MIME_TYPES.includes(file.mimeType),
  playable: PLAYABLE_MIME_TYPES.includes(file.mimeType),
  durationMs: file.durationMs,
  uploadedById: file.uploadedById,
  createdAt: file.createdAt,
  completedAt: file.completedAt,
});

/** The action items and decisions of a recording (its summary is the file's `summary`). */
export interface RecordingInsightsView {
  actionItems: ActionItemInsight[];
  decisions: DecisionInsight[];
}

/** What the views include of a file's insights: the lists in their stored order. */
export const INSIGHTS_INCLUDE = {
  include: {
    actionItems: { orderBy: { position: 'asc' } },
    decisions: { orderBy: { position: 'asc' } },
  },
} as const;

/** A file with its summary and insights, as listed (`GET /meetings/:id/files`). */
export interface MeetingFileListItem extends MeetingFileView {
  /**
   * Set once a document or a recording is `READY`: the insights' summary of a recording analyzed
   * with them, else the older summary; `null` before, on failure and for images.
   */
  summary: string | null;
  /** The action items and decisions once a recording is `READY`; `null` otherwise and for documents. */
  insights: RecordingInsightsView | null;
  /**
   * Whether the analysis can be started: a `READY` recording with a transcript but no insights,
   * and no analysis running. Who may start it (the owner) is checked by the web and the route.
   */
  canAnalyze: boolean;
}

/** A file as the list and details read it, with its summary and insights. */
type FileWithResults = MeetingFile & {
  summary: { text: string } | null;
  insights:
    (RecordingInsights & { actionItems: ActionItem[]; decisions: MeetingDecision[] }) | null;
};

/** `segmentCount`: how many transcript segments the file has (the list counts, it never loads them). */
export const toMeetingFileListItem = (
  file: FileWithResults,
  segmentCount: number,
): MeetingFileListItem => ({
  ...toMeetingFileView(file),
  canAnalyze:
    file.status === 'READY' &&
    isRecording(file.kind) &&
    segmentCount > 0 &&
    !file.insights &&
    file.analysisStatus !== 'RUNNING',
  summary: file.insights?.summary ?? file.summary?.text ?? null,
  insights: file.insights && {
    actionItems: file.insights.actionItems.map(({ description, assignee }) => ({
      description,
      assignee,
    })),
    decisions: file.insights.decisions.map(({ text }) => ({ text })),
  },
});

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
  file: FileWithResults & { transcript: TranscriptSegment[] },
): MeetingFileDetails => ({
  ...toMeetingFileListItem(file, file.transcript.length),
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

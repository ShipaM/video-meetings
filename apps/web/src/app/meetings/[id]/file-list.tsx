'use client';

import { AlertDialog, Button, Chip, Spinner } from '@heroui/react';
import { useEffect, useId, useRef, useState } from 'react';
import { clearAccessToken } from '../../auth-storage';
import {
  formatDuration,
  formatFileSize,
  formatMeetingDate,
  type MeetingFile,
} from '../../meetings';
import {
  ANALYSIS_FAILED_ANNOUNCEMENT,
  ANALYSIS_FAILED_TEXT,
  ANALYSIS_READY_ANNOUNCEMENT,
  ANALYSIS_RESTART_OWNER_TEXT,
  ANALYSIS_RESTART_PARTICIPANT_TEXT,
  ANALYSIS_RUNNING_TEXT,
  ANNOUNCEMENT_RESET_MS,
  FILE_KIND_LABEL,
  FILE_STATUS,
  PLAYER_FAILED_MESSAGE,
  PREVIEW_FAILED_MESSAGE,
  PROCESSING_TEXT,
  RECORDING_STAGE_TEXT,
} from './constants';
import { FilePreviewPanel, FileSummary, ImageThumbnail, useFileLink } from './file-preview';
import { getExtension } from './file-types';
import { deleteFile, downloadFile, retryProcessing, startAnalysis } from './files-api';
import { RecordingInsights } from './recording-insights';
import { RecordingPanel } from './recording-player';
import { UnmountListener } from './unmount-listener';
import { useConfirmedRemoval } from './use-confirmed-removal';

/** Extension in upper case for display, e.g. `PDF`; falls back to the file kind. */
function getTypeLabel(file: MeetingFile): string {
  const extension = getExtension(file.originalName).toUpperCase();
  return extension ? `${FILE_KIND_LABEL[file.kind]} · ${extension}` : FILE_KIND_LABEL[file.kind];
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** Delete button with a confirmation dialog; the dialog stays open until the API has answered. */
function DeleteFileButton({ file, onDeleted }: { file: MeetingFile; onDeleted: () => void }) {
  const removal = useConfirmedRemoval(onDeleted);

  return (
    <>
      <Button
        isIconOnly
        variant="danger-soft"
        className="size-11 shrink-0 sm:size-10"
        aria-label={`Delete ${file.originalName}`}
        onPress={removal.open}
      >
        <TrashIcon />
      </Button>
      <AlertDialog.Backdrop
        isOpen={removal.isOpen}
        onOpenChange={removal.onOpenChange}
        isKeyboardDismissDisabled={false}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-105">
            <UnmountListener onUnmount={removal.onDialogUnmount} />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete this file?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>
                <strong className="break-all">{file.originalName}</strong> will be removed from the
                meeting for everyone, and its download links will stop working. This cannot be
                undone.
              </p>
              {removal.error !== null && (
                <p role="alert" className="text-danger text-sm">
                  {removal.error}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary" isDisabled={removal.isPending}>
                Keep file
              </Button>
              <Button
                variant="danger"
                isPending={removal.isPending}
                onPress={() => removal.confirm(() => deleteFile(file.meetingId, file.id))}
              >
                Delete file
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

/** What the owner can do with a file; a participant gets none of it (read-only page). */
export type FileActions = {
  onDeleted: (fileId: string) => void;
  /** Called after Retry: with the file now `PROCESSING`, or without one to reload the list. */
  onRetried: (file?: MeetingFile) => void;
  /** Called after Analyze meeting: with the file now analyzing, or without one to reload the list. */
  onAnalysisStarted: (file?: MeetingFile) => void;
};

const actionButtonClass = 'min-h-11 flex-1 sm:min-h-10 sm:flex-none';

function FileRow({ file, actions }: { file: MeetingFile; actions?: FileActions }) {
  const [isPending, setIsPending] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const previewId = useId();
  const playerId = useId();
  // One link per row: a file is either previewable (PDF, image) or playable (audio, video).
  const preview = useFileLink(
    file.meetingId,
    file.id,
    file.playable ? PLAYER_FAILED_MESSAGE : PREVIEW_FAILED_MESSAGE,
  );
  const hasThumbnail = file.kind === 'IMAGE' && file.previewable;
  const status = FILE_STATUS[file.status];

  async function handleDownload() {
    setIsPending(true);
    setError(null);
    setError(await downloadFile(file));
    setIsPending(false);
  }

  function togglePreview() {
    // A reopened preview gets a fresh link if the old one is about to expire.
    if (!isPreviewOpen) void preview.load();
    setIsPreviewOpen((open) => !open);
  }

  function togglePlayer() {
    // The player keeps one link while it is open and replaces it itself when it stops working.
    if (!isPlayerOpen) void preview.load();
    setIsPlayerOpen((open) => !open);
  }

  async function handleRetry() {
    if (!actions) return;
    setIsRetrying(true);
    setError(null);
    const result = await retryProcessing(file);
    setIsRetrying(false);
    if (result.type === 'unauthorized') {
      clearAccessToken();
    } else if (result.type === 'retried') {
      actions.onRetried(result.file);
      // Retry goes away with the FAILED status: keep keyboard focus in the row.
      requestAnimationFrame(() => downloadButton.current?.focus());
    } else {
      setError(result.message);
      if (result.type === 'stale') actions.onRetried();
    }
  }

  async function handleAnalyze() {
    if (!actions) return;
    setIsStartingAnalysis(true);
    setError(null);
    const result = await startAnalysis(file);
    setIsStartingAnalysis(false);
    if (result.type === 'unauthorized') {
      clearAccessToken();
    } else if (result.type === 'error') {
      setError(result.message);
    } else {
      if (result.type === 'started') {
        actions.onAnalysisStarted(result.file);
      } else {
        setError(result.message);
        actions.onAnalysisStarted();
      }
      // The action goes away with the reloaded state: keep keyboard focus in the row.
      requestAnimationFrame(() => downloadButton.current?.focus());
    }
  }

  return (
    <li className="border-default flex flex-col gap-3 rounded-2xl border px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {hasThumbnail && (
            <ImageThumbnail name={file.originalName} preview={preview} onPress={togglePreview} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium break-all">{file.originalName}</span>
              <Chip size="sm" variant="soft" color={status.color} className="whitespace-nowrap">
                {file.status === 'PROCESSING' && <Spinner size="sm" color="current" />}
                {status.label}
              </Chip>
            </div>
            <p className="text-muted text-sm">
              {getTypeLabel(file)}
              {file.durationMs !== null && ` · ${formatDuration(file.durationMs)}`} ·{' '}
              {formatFileSize(file.size)} ·{' '}
              <time dateTime={file.completedAt ?? file.createdAt}>
                {formatMeetingDate(file.completedAt ?? file.createdAt)}
              </time>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {file.previewable && (
            <Button
              variant="tertiary"
              className={actionButtonClass}
              aria-label={`${isPreviewOpen ? 'Hide' : 'Show'} preview of ${file.originalName}`}
              aria-expanded={isPreviewOpen}
              aria-controls={isPreviewOpen ? previewId : undefined}
              onPress={togglePreview}
            >
              {isPreviewOpen ? (
                // One child: the button spaces its children apart.
                <span>
                  Hide<span className="hidden sm:inline"> preview</span>
                </span>
              ) : (
                'Preview'
              )}
            </Button>
          )}
          {file.playable && (
            <Button
              variant="tertiary"
              className={actionButtonClass}
              aria-label={`${isPlayerOpen ? 'Hide player of' : 'Play'} ${file.originalName}`}
              aria-expanded={isPlayerOpen}
              aria-controls={isPlayerOpen ? playerId : undefined}
              onPress={togglePlayer}
            >
              {isPlayerOpen ? (
                <span>
                  Hide<span className="hidden sm:inline"> player</span>
                </span>
              ) : (
                'Play'
              )}
            </Button>
          )}
          {actions && file.status === 'FAILED' && (
            <Button
              variant="secondary"
              className={actionButtonClass}
              aria-label={`Retry processing of ${file.originalName}`}
              isPending={isRetrying}
              onPress={handleRetry}
            >
              Retry
            </Button>
          )}
          {actions && file.canAnalyze && (
            <Button
              variant="secondary"
              className={actionButtonClass}
              aria-label={`Analyze meeting ${file.originalName}`}
              isPending={isStartingAnalysis}
              onPress={handleAnalyze}
            >
              Analyze meeting
            </Button>
          )}
          <Button
            ref={downloadButton}
            variant="secondary"
            className={actionButtonClass}
            aria-label={`Download ${file.originalName}`}
            isPending={isPending}
            onPress={handleDownload}
          >
            Download
          </Button>
          {actions && <DeleteFileButton file={file} onDeleted={() => actions.onDeleted(file.id)} />}
        </div>
      </div>

      {file.status === 'PROCESSING' && (
        <p className="text-muted text-sm">
          {file.processingStage
            ? `${RECORDING_STAGE_TEXT[file.processingStage]}.`
            : PROCESSING_TEXT[file.kind]}{' '}
          The status updates by itself.
        </p>
      )}
      {file.status === 'FAILED' && (
        <p className="text-danger text-sm">
          Processing failed: {file.failureReason ?? 'unknown error'}.
          {!actions && ' Only the owner can retry it.'}
        </p>
      )}
      {file.status === 'READY' && file.analysisStatus === 'RUNNING' && (
        <p className="text-muted flex items-center gap-2 text-sm">
          <Spinner size="sm" color="current" />
          {ANALYSIS_RUNNING_TEXT}
        </p>
      )}
      {file.status === 'READY' && file.analysisStatus === 'FAILED' && (
        <p className="text-danger text-sm">
          {ANALYSIS_FAILED_TEXT}{' '}
          {actions ? ANALYSIS_RESTART_OWNER_TEXT : ANALYSIS_RESTART_PARTICIPANT_TEXT}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {file.status === 'READY' && file.insights !== null ? (
        <RecordingInsights summary={file.summary} insights={file.insights} />
      ) : (
        file.status === 'READY' && file.summary !== null && <FileSummary summary={file.summary} />
      )}
      {isPreviewOpen && <FilePreviewPanel id={previewId} file={file} preview={preview} />}
      {isPlayerOpen && <RecordingPanel id={playerId} file={file} link={preview} playOnOpen />}
    </li>
  );
}

/**
 * Announces files that finished processing or an analysis (one polite, atomic message), without
 * moving focus.
 * The region is emptied before each message, so a repeated one (a retry that failed again) is
 * read out too.
 */
function useProcessingAnnouncement(files: MeetingFile[]): string {
  const previous = useRef<Map<string, Pick<MeetingFile, 'status' | 'analysisStatus'>> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [message, setMessage] = useState('');

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(
      files.map((file) => [file.id, { status: file.status, analysisStatus: file.analysisStatus }]),
    );
    if (!before) return; // the first load announces nothing
    const messages = files.flatMap((file) => {
      const old = before.get(file.id);
      if (old?.status === 'PROCESSING' && file.status !== 'PROCESSING') {
        return file.status === 'FAILED'
          ? [`${file.originalName}: processing failed.`]
          : [`${file.originalName} is ready.`];
      }
      if (old?.analysisStatus === 'RUNNING' && file.analysisStatus === 'FAILED') {
        return [`${file.originalName}: ${ANALYSIS_FAILED_ANNOUNCEMENT}`];
      }
      if (old?.analysisStatus === 'RUNNING' && file.analysisStatus === null && file.insights) {
        return [`${file.originalName}: ${ANALYSIS_READY_ANNOUNCEMENT}`];
      }
      return [];
    });
    if (messages.length === 0) return;
    const text = messages.join(' ');
    setMessage('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(text), ANNOUNCEMENT_RESET_MS);
  }, [files]);

  return message;
}

export function FileList({
  files,
  actions,
}: {
  files: MeetingFile[];
  /** Omitted for a read-only (participant) view: Retry, Analyze meeting and delete are hidden. */
  actions?: FileActions;
}) {
  const announcement = useProcessingAnnouncement(files);

  return (
    <>
      <p role="status" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      {files.length === 0 ? (
        <p className="border-default rounded-2xl border border-dashed p-6 text-center text-sm">
          {actions
            ? 'No files yet. Upload recordings, documents or images above.'
            : 'No files yet. The owner has not uploaded anything to this meeting.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((file) => (
            <FileRow key={file.id} file={file} actions={actions} />
          ))}
        </ul>
      )}
    </>
  );
}

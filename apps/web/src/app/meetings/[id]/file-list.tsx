'use client';

import { AlertDialog, Button, Chip } from '@heroui/react';
import { useState } from 'react';
import { formatFileSize, formatMeetingDate, type MeetingFile } from '../../meetings';
import { FILE_KIND_LABEL, FILE_STATUS } from './constants';
import { getExtension } from './file-types';
import { deleteFile, downloadFile } from './files-api';
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

function FileRow({
  file,
  onDeleted,
}: {
  file: MeetingFile;
  /** Absent for a participant, who may not delete (no button is shown). */
  onDeleted?: () => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = FILE_STATUS[file.status];

  async function handleDownload() {
    setIsPending(true);
    setError(null);
    setError(await downloadFile(file));
    setIsPending(false);
  }

  return (
    <li className="border-default flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{file.originalName}</span>
          <Chip size="sm" variant="soft" color={status.color}>
            {status.label}
          </Chip>
        </div>
        <p className="text-muted text-sm">
          {getTypeLabel(file)} · {formatFileSize(file.size)} ·{' '}
          <time dateTime={file.completedAt ?? file.createdAt}>
            {formatMeetingDate(file.completedAt ?? file.createdAt)}
          </time>
        </p>
        {error !== null && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="min-h-11 flex-1 sm:min-h-10 sm:flex-none"
          aria-label={`Download ${file.originalName}`}
          isPending={isPending}
          onPress={handleDownload}
        >
          Download
        </Button>
        {onDeleted && <DeleteFileButton file={file} onDeleted={onDeleted} />}
      </div>
    </li>
  );
}

export function FileList({
  files,
  onDeleted,
}: {
  files: MeetingFile[];
  /** Omitted for a read-only (participant) view: the delete buttons are hidden. */
  onDeleted?: (fileId: string) => void;
}) {
  if (files.length === 0) {
    return (
      <p className="border-default rounded-2xl border border-dashed p-6 text-center text-sm">
        {onDeleted
          ? 'No files yet. Upload recordings, documents or images above.'
          : 'No files yet. The owner has not uploaded anything to this meeting.'}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => (
        <FileRow key={file.id} file={file} onDeleted={onDeleted && (() => onDeleted(file.id))} />
      ))}
    </ul>
  );
}

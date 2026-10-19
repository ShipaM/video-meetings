'use client';

import { AlertDialog, Button, Chip, useOverlayState } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { clearAccessToken, getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import { formatFileSize, formatMeetingDate, type MeetingFile } from '../../meetings';
import { FILE_KIND_LABEL, FILE_STATUS } from './constants';
import { getExtension } from './file-types';

/** Extension in upper case for display, e.g. `PDF`; falls back to the file kind. */
function getTypeLabel(file: MeetingFile): string {
  const extension = getExtension(file.originalName).toUpperCase();
  return extension ? `${FILE_KIND_LABEL[file.kind]} · ${extension}` : FILE_KIND_LABEL[file.kind];
}

/** Asks the API for a short-lived signed link and lets the browser download it. */
async function downloadFile(file: MeetingFile): Promise<string | null> {
  const token = getAccessToken();
  if (!token) {
    clearAccessToken();
    return null;
  }
  try {
    const response = await fetch(`${API_URL}/meetings/${file.meetingId}/files/${file.id}/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      clearAccessToken();
      return null;
    }
    if (response.status === 404) return 'This file is no longer available.';
    if (!response.ok) return 'Could not start the download. Please try again.';

    const { url } = (await response.json()) as { url: string };
    // The response is `Content-Disposition: attachment`, so the page stays where it is.
    const link = document.createElement('a');
    link.href = `${API_URL}${url}`;
    link.rel = 'noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
    return null;
  } catch {
    return 'The server is unavailable. Please try again later.';
  }
}

type DeleteResult =
  { type: 'deleted' } | { type: 'unauthorized' } | { type: 'error'; message: string };

/** Deletes the stored original and its record; a file that is already gone counts as deleted. */
async function deleteFile(file: MeetingFile): Promise<DeleteResult> {
  const token = getAccessToken();
  if (!token) return { type: 'unauthorized' };
  try {
    const response = await fetch(`${API_URL}/meetings/${file.meetingId}/files/${file.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) return { type: 'unauthorized' };
    if (response.ok || response.status === 404) return { type: 'deleted' };
    return { type: 'error', message: 'Could not delete the file. Please try again.' };
  } catch {
    return { type: 'error', message: 'The server is unavailable. Please try again later.' };
  }
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

/** Calls `onUnmount` when the dialog content leaves the DOM, i.e. after its exit animation. */
function UnmountListener({ onUnmount }: { onUnmount: () => void }) {
  const callback = useRef(onUnmount);
  useEffect(() => {
    callback.current = onUnmount;
  }, [onUnmount]);
  useEffect(() => () => callback.current(), []);
  return null;
}

/** Delete button with a confirmation dialog; the dialog stays open until the API has answered. */
function DeleteFileButton({ file, onDeleted }: { file: MeetingFile; onDeleted: () => void }) {
  const dialog = useOverlayState();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row (and this button) goes only once the dialog has closed: the dialog returns focus to
  // this button first, so the page can then move it to the file section instead of losing it.
  const isDeleted = useRef(false);

  function handleOpenChange(isOpen: boolean) {
    if (isPending) return;
    setError(null);
    dialog.setOpen(isOpen);
  }

  async function handleConfirm() {
    setIsPending(true);
    setError(null);
    const result = await deleteFile(file);
    setIsPending(false);
    if (result.type === 'deleted') {
      isDeleted.current = true;
      dialog.close();
    } else if (result.type === 'unauthorized') {
      clearAccessToken(); // expired token: back to the login page
    } else {
      setError(result.message);
    }
  }

  return (
    <>
      <Button
        isIconOnly
        variant="danger-soft"
        className="size-11 shrink-0 sm:size-10"
        aria-label={`Delete ${file.originalName}`}
        onPress={dialog.open}
      >
        <TrashIcon />
      </Button>
      <AlertDialog.Backdrop
        isOpen={dialog.isOpen}
        onOpenChange={handleOpenChange}
        isKeyboardDismissDisabled={false}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-105">
            <UnmountListener onUnmount={() => isDeleted.current && onDeleted()} />
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
              {error !== null && (
                <p role="alert" className="text-danger text-sm">
                  {error}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary" isDisabled={isPending}>
                Keep file
              </Button>
              <Button variant="danger" isPending={isPending} onPress={handleConfirm}>
                Delete file
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function FileRow({ file, onDeleted }: { file: MeetingFile; onDeleted: () => void }) {
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
        <DeleteFileButton file={file} onDeleted={onDeleted} />
      </div>
    </li>
  );
}

export function FileList({
  files,
  onDeleted,
}: {
  files: MeetingFile[];
  onDeleted: (fileId: string) => void;
}) {
  if (files.length === 0) {
    return (
      <p className="border-default rounded-2xl border border-dashed p-6 text-center text-sm">
        No files yet. Upload recordings, documents or images above.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => (
        <FileRow key={file.id} file={file} onDeleted={() => onDeleted(file.id)} />
      ))}
    </ul>
  );
}

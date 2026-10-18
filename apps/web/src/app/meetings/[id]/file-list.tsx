'use client';

import { Button, Chip } from '@heroui/react';
import { useState } from 'react';
import { clearAccessToken, getAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import {
  formatFileSize,
  formatMeetingDate,
  type MeetingFile,
  type MeetingFileKind,
  type MeetingFileStatus,
} from '../../meetings';

const KIND_LABEL: Record<MeetingFileKind, string> = {
  AUDIO: 'Audio',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  IMAGE: 'Image',
};

const STATUS: Record<
  MeetingFileStatus,
  { label: string; color: 'default' | 'accent' | 'success' | 'danger' }
> = {
  UPLOADING: { label: 'Uploading', color: 'default' },
  PROCESSING: { label: 'Processing', color: 'accent' },
  READY: { label: 'Ready', color: 'success' },
  FAILED: { label: 'Failed', color: 'danger' },
};

/** Extension in upper case for display, e.g. `PDF`; falls back to the file kind. */
function getTypeLabel(file: MeetingFile): string {
  const dot = file.originalName.lastIndexOf('.');
  const extension = dot > 0 ? file.originalName.slice(dot + 1).toUpperCase() : '';
  return extension ? `${KIND_LABEL[file.kind]} · ${extension}` : KIND_LABEL[file.kind];
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

function FileRow({ file }: { file: MeetingFile }) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[file.status];

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
      <Button
        variant="secondary"
        className="w-full sm:w-auto"
        aria-label={`Download ${file.originalName}`}
        isPending={isPending}
        onPress={handleDownload}
      >
        Download
      </Button>
    </li>
  );
}

export function FileList({ files }: { files: MeetingFile[] }) {
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
        <FileRow key={file.id} file={file} />
      ))}
    </ul>
  );
}

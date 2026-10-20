'use client';

import { Button, Skeleton } from '@heroui/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MeetingFile } from '../../meetings';
import {
  FILE_LINK_REFRESH_MARGIN_MS,
  PREVIEW_FAILED_MESSAGE,
  PREVIEW_MIME_TYPES,
  SUMMARY_CLAMP_CHARACTERS,
} from './constants';
import { type FileLink, inlineUrl, requestFileLink } from './files-api';

/** Whether the API serves this file inline, so the page can show it (PDF, PNG, JPEG). */
export function canPreview(file: MeetingFile): boolean {
  return PREVIEW_MIME_TYPES.includes(file.mimeType);
}

/**
 * A signed link to the file for previews, requested on `load()` and reused until shortly before it
 * expires (links live 5 minutes). Overlapping `load()` calls send one request.
 */
export function useFileLink(meetingId: string, fileId: string) {
  const [link, setLink] = useState<FileLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkRef = useRef<FileLink | null>(null);
  const pending = useRef<Promise<void> | null>(null);

  const load = useCallback((): Promise<void> => {
    const current = linkRef.current;
    if (current && current.expiresAt - Date.now() > FILE_LINK_REFRESH_MARGIN_MS) {
      return Promise.resolve();
    }
    pending.current ??= (async () => {
      setError(null);
      const result = await requestFileLink({ meetingId, id: fileId }, PREVIEW_FAILED_MESSAGE);
      pending.current = null;
      if (result.type === 'link') {
        linkRef.current = result.link;
        setLink(result.link);
      } else if (result.type === 'error') {
        setError(result.message);
      }
    })();
    return pending.current;
  }, [meetingId, fileId]);

  return { link, error, load };
}

function ImageIcon() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

/**
 * A small square thumbnail of an image file. Mouse users can click it to toggle the preview;
 * keyboard and screen reader users have the row's Preview button, so it is hidden from them.
 */
export function ImageThumbnail({
  name,
  link,
  error,
  onPress,
}: {
  name: string;
  link: FileLink | null;
  error: string | null;
  onPress: () => void;
}) {
  const [isBroken, setIsBroken] = useState(false);
  const showImage = link !== null && !isBroken;

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      title={`Preview ${name}`}
      onClick={onPress}
      className="border-default text-muted relative flex size-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border"
    >
      {showImage && (
        // A signed, short-lived API URL: next/image cannot optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={inlineUrl(link)}
          alt=""
          className="size-full object-cover"
          onError={() => setIsBroken(true)}
        />
      )}
      {!showImage && link === null && error === null && (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {!showImage && (link !== null || error !== null) && <ImageIcon />}
    </button>
  );
}

/** The opened preview of a PDF or an image, below its row. */
export function FilePreviewPanel({
  id,
  file,
  link,
  error,
  onRetry,
}: {
  id: string;
  file: MeetingFile;
  link: FileLink | null;
  error: string | null;
  onRetry: () => void;
}) {
  const isPdf = file.mimeType === 'application/pdf';
  // Mobile browsers (e.g. Chrome on Android) have no built-in PDF viewer: an iframe would only
  // start a download there, so they get the "open" link alone.
  const hasPdfViewer = typeof navigator !== 'undefined' && navigator.pdfViewerEnabled;

  return (
    <div id={id} className="border-default flex flex-col gap-3 rounded-xl border p-3">
      {error !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-danger flex-1 text-sm">
            {error}
          </p>
          <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-9" onPress={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {error === null && link === null && (
        <Skeleton
          className="h-64 rounded-lg sm:h-96"
          aria-busy="true"
          aria-label={`Loading the preview of ${file.originalName}`}
        />
      )}
      {link !== null && !isPdf && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={inlineUrl(link)}
          alt={`Preview of ${file.originalName}`}
          className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain"
        />
      )}
      {link !== null && isPdf && hasPdfViewer && (
        <iframe
          src={inlineUrl(link)}
          title={`Preview of ${file.originalName}`}
          className="h-[70vh] min-h-80 w-full rounded-lg bg-white"
        />
      )}
      {link !== null && isPdf && !hasPdfViewer && (
        <p className="text-muted text-sm">This browser cannot show PDF files inside the page.</p>
      )}
      {link !== null && (
        <a
          href={inlineUrl(link)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent w-fit text-sm font-medium underline-offset-4 hover:underline"
        >
          Open in a new tab
        </a>
      )}
    </div>
  );
}

/** The summary of a processed document; a long one is clamped with "Show more". */
export function FileSummary({ summary }: { summary: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const textId = useId();
  const isLong = summary.length > SUMMARY_CLAMP_CHARACTERS;

  return (
    <div className="bg-surface-secondary/60 flex flex-col gap-1 rounded-xl px-3 py-2">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">Summary</p>
      <p
        id={textId}
        className={`text-sm leading-relaxed whitespace-pre-line ${isLong && !isExpanded ? 'line-clamp-4' : ''}`}
      >
        {summary}
      </p>
      {isLong && (
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 min-h-11 w-fit sm:min-h-8"
          aria-expanded={isExpanded}
          aria-controls={textId}
          onPress={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}

/** Requests the link once an image row mounts, so its thumbnail shows right away. */
export function useImageThumbnailLink(file: MeetingFile, load: () => Promise<void>) {
  const isImage = file.kind === 'IMAGE' && canPreview(file);
  useEffect(() => {
    if (isImage) void load();
  }, [isImage, load]);
  return isImage;
}

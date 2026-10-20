'use client';

import { Button, Skeleton } from '@heroui/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MeetingFile } from '../../meetings';
import {
  FILE_LINK_REUSE_MS,
  POPUP_BLOCKED_MESSAGE,
  PREVIEW_FAILED_MESSAGE,
  THUMBNAIL_ROOT_MARGIN,
} from './constants';
import { type FileLink, inlineUrl, requestFileLink } from './files-api';

/**
 * A signed link to the file for previews and the player. `load()` reuses the current link while it is young
 * enough and otherwise asks for a new one (`force` always does); overlapping calls send one
 * request. A failed request drops the old link, so an expired one is never shown with the error.
 */
export function useFileLink(
  meetingId: string,
  fileId: string,
  failedMessage = PREVIEW_FAILED_MESSAGE,
) {
  const [link, setLink] = useState<FileLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkRef = useRef<FileLink | null>(null);
  const pending = useRef<Promise<FileLink | null> | null>(null);

  const load = useCallback(
    (force = false): Promise<FileLink | null> => {
      const current = linkRef.current;
      if (!force && current && performance.now() - current.receivedAt < FILE_LINK_REUSE_MS) {
        return Promise.resolve(current);
      }
      pending.current ??= (async () => {
        setError(null);
        const result = await requestFileLink({ meetingId, id: fileId }, failedMessage);
        pending.current = null;
        if (result.type === 'link') {
          linkRef.current = result.link;
          setLink(result.link);
          return result.link;
        }
        linkRef.current = null;
        setLink(null);
        if (result.type === 'error') setError(result.message);
        return null;
      })();
      return pending.current;
    },
    [meetingId, fileId, failedMessage],
  );

  return { link, error, load };
}

export type FileLinkState = ReturnType<typeof useFileLink>;

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
 * A small square thumbnail of an image file. It asks for its link only once the row comes near
 * the viewport. Mouse users can click it to toggle the preview; keyboard and screen reader users
 * have the row's Preview button, so it is hidden from them.
 */
export function ImageThumbnail({
  name,
  preview,
  onPress,
}: {
  name: string;
  preview: FileLinkState;
  onPress: () => void;
}) {
  const { link, error, load } = preview;
  const button = useRef<HTMLButtonElement>(null);
  // The thumbnail keeps the first link that worked: a newer link (for the preview) would make it
  // download the original again (responses are `no-store`). A broken one takes the next link.
  const [shown, setShown] = useState<FileLink | null>(null);
  const [isBroken, setIsBroken] = useState(false);
  if (link !== null && link !== shown && (shown === null || isBroken)) {
    setShown(link);
    setIsBroken(false);
  }

  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: THUMBNAIL_ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [load]);

  const showImage = shown !== null && !isBroken;

  return (
    <button
      ref={button}
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
          src={inlineUrl(shown)}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setIsBroken(true)}
        />
      )}
      {!showImage && error === null && !isBroken && (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {!showImage && (error !== null || isBroken) && <ImageIcon />}
    </button>
  );
}

/** An error in a preview or player panel, with Try again next to it. */
export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-danger flex-1 text-sm">
        {message}
      </p>
      <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-9" onPress={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The opened preview of a PDF or an image, below its row. */
export function FilePreviewPanel({
  id,
  file,
  preview,
}: {
  id: string;
  file: MeetingFile;
  preview: FileLinkState;
}) {
  const { link, error, load } = preview;
  // The link whose image failed to load (expired, file gone); a new link clears it.
  const [failedLink, setFailedLink] = useState<FileLink | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const shownError =
    error ?? (link !== null && link === failedLink ? PREVIEW_FAILED_MESSAGE : null);
  const isPdf = file.mimeType === 'application/pdf';
  // Mobile browsers without a PDF viewer (e.g. Chrome on Android) report `false`: an iframe would
  // only start a download there. Older desktop browsers lack the property and can show PDFs.
  const hasPdfViewer = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;

  async function openInNewTab() {
    setOpenError(null);
    // Opened while handling the click, so it is not blocked as a pop-up; it gets the URL once a
    // link that is still valid is there.
    const tab = window.open('', '_blank');
    if (!tab) {
      setOpenError(POPUP_BLOCKED_MESSAGE);
      return;
    }
    tab.opener = null;
    const fresh = await load();
    if (fresh) {
      tab.location.href = inlineUrl(fresh);
    } else {
      tab.close(); // the panel shows the error
    }
  }

  return (
    <div id={id} className="border-default flex flex-col gap-3 rounded-xl border p-3">
      {shownError !== null && <PanelError message={shownError} onRetry={() => void load(true)} />}
      {shownError === null && link === null && (
        <Skeleton
          className="h-64 rounded-lg sm:h-96"
          aria-busy="true"
          aria-label={`Loading the preview of ${file.originalName}`}
        />
      )}
      {shownError === null && link !== null && !isPdf && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={inlineUrl(link)}
          alt={`Preview of ${file.originalName}`}
          className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain"
          onError={() => setFailedLink(link)}
        />
      )}
      {shownError === null && link !== null && isPdf && hasPdfViewer && (
        // The API sends a preview whole (no byte ranges), so the viewer has all of it before the
        // short-lived link expires.
        <iframe
          src={inlineUrl(link)}
          title={`Preview of ${file.originalName}`}
          className="h-[70vh] min-h-80 w-full rounded-lg bg-white"
        />
      )}
      {shownError === null && link !== null && isPdf && !hasPdfViewer && (
        <p className="text-muted text-sm">This browser cannot show PDF files inside the page.</p>
      )}
      {shownError === null && link !== null && (
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-accent -ml-2 min-h-11 w-fit sm:min-h-8"
            onPress={() => void openInNewTab()}
          >
            Open in a new tab
          </Button>
          {openError !== null && (
            <p role="alert" className="text-danger text-sm">
              {openError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The summary of a processed document, clamped to four lines. "Show more" appears only when the
 * clamp actually hides text, measured on the rendered paragraph (it follows resizes).
 */
export function FileSummary({ summary }: { summary: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  const textId = useId();

  useLayoutEffect(() => {
    const element = text.current;
    if (!element || isExpanded) return;
    // The observer also reports once right after `observe`, which gives the first measurement.
    const observer = new ResizeObserver(() =>
      setIsClamped(element.scrollHeight > element.clientHeight + 1),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [summary, isExpanded]);

  return (
    <div className="bg-surface-secondary/60 flex flex-col gap-1 rounded-xl px-3 py-2">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">Summary</p>
      <p
        ref={text}
        id={textId}
        className={`text-sm leading-relaxed whitespace-pre-line ${isExpanded ? '' : 'line-clamp-4'}`}
      >
        {summary}
      </p>
      {(isExpanded || isClamped) && (
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

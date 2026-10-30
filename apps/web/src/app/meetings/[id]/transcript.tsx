'use client';

import { Skeleton } from '@heroui/react';
import { memo, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { formatDuration, type MeetingFile, type TranscriptSegment } from '../../meetings';
import { TRANSCRIPT_FAILED_MESSAGE, TRANSCRIPT_FOLLOW_PAUSE_MS } from './constants';
import { PanelError } from './file-preview';
import { fetchTranscript } from './files-api';

type TranscriptState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  /** `null`: the recording has no transcript (processed before recordings were transcribed). */
  | { type: 'loaded'; segments: TranscriptSegment[] | null };

/** Loads the transcript once the recording is `READY` (again after `reload`). */
export function useTranscript(file: MeetingFile) {
  const [state, setState] = useState<TranscriptState>({ type: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const isReady = file.status === 'READY';
  const { meetingId, id } = file;

  useEffect(() => {
    if (!isReady) return;
    const controller = new AbortController();
    fetchTranscript({ meetingId, id }, controller.signal).then(
      (result) => {
        if (result.type === 'transcript') {
          setState({ type: 'loaded', segments: result.transcript });
        } else {
          // `unauthorized`: the token is already cleared and the page goes to the login page.
          setState({
            type: 'error',
            message: result.type === 'error' ? result.message : TRANSCRIPT_FAILED_MESSAGE,
          });
        }
      },
      () => {
        // Aborted: the panel was closed.
      },
    );
    return () => controller.abort();
  }, [meetingId, id, isReady, attempt]);

  const reload = useCallback(() => {
    setState({ type: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload };
}

/**
 * The index of the transcript line playing, outside React state: it changes every few seconds
 * during playback, and only the two lines whose highlight changes should render again, not the
 * panel and the whole list of a long meeting.
 */
export type ActiveLineStore = {
  get: () => number;
  set: (index: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createActiveLineStore(): ActiveLineStore {
  let current = -1;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (index) => {
      if (index === current) return;
      current = index;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Index of the segment playing at `ms`: the last one started by then, `-1` before the first. */
export function findSegmentIndex(segments: TranscriptSegment[], ms: number): number {
  let low = 0;
  let high = segments.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle].startMs <= ms) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

const TranscriptLine = memo(function TranscriptLine({
  segment,
  index,
  activeLine,
  onSeek,
}: {
  segment: TranscriptSegment;
  index: number;
  activeLine: ActiveLineStore;
  onSeek: (ms: number) => void;
}) {
  const isActive = useSyncExternalStore(
    activeLine.subscribe,
    () => activeLine.get() === index,
    () => false,
  );

  return (
    <li>
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onSeek(segment.startMs)}
        className={`focus-visible:outline-accent flex min-h-11 w-full cursor-pointer items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-sm leading-relaxed transition-colors focus-visible:outline-2 sm:min-h-0 ${
          isActive
            ? 'bg-accent-soft text-accent-soft-foreground shadow-[inset_3px_0_0_var(--accent)]'
            : 'hover:bg-default'
        }`}
      >
        <span className="sr-only">Play from </span>
        <time
          dateTime={`PT${Math.floor(segment.startMs / 1000)}S`}
          className={`w-12 shrink-0 text-xs tabular-nums ${
            isActive ? 'font-medium' : 'text-muted'
          }`}
        >
          {formatDuration(segment.startMs)}
        </time>
        <span className="min-w-0 wrap-break-word">{segment.text}</span>
      </button>
    </li>
  );
});

/**
 * The timed transcript. The line playing is highlighted, and the list scrolls itself (not the
 * page) to keep it in view, unless the user has just scrolled or moved through it themselves.
 */
const TranscriptList = memo(function TranscriptList({
  segments,
  activeLine,
  onSeek,
}: {
  segments: TranscriptSegment[];
  activeLine: ActiveLineStore;
  onSeek: (ms: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const followPausedUntil = useRef(0);

  useEffect(
    () =>
      activeLine.subscribe(() => {
        const element = list.current;
        const item = element?.children[activeLine.get()] as HTMLElement | undefined;
        if (!element || !item || performance.now() < followPausedUntil.current) return;
        const top = item.offsetTop;
        const isVisible =
          top >= element.scrollTop &&
          top + item.offsetHeight <= element.scrollTop + element.clientHeight;
        if (isVisible) return;
        const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        element.scrollTo({
          top: top - element.clientHeight / 3,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }),
    [activeLine],
  );

  const pauseFollowing = () => {
    followPausedUntil.current = performance.now() + TRANSCRIPT_FOLLOW_PAUSE_MS;
  };
  const seek = useCallback(
    (ms: number) => {
      followPausedUntil.current = 0; // the chosen line becomes the one followed
      onSeek(ms);
    },
    [onSeek],
  );

  return (
    <ol
      ref={list}
      // Positioned, so the lines' `offsetTop` is measured from the list.
      className="bg-surface-secondary/60 relative flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl p-1"
      onWheel={pauseFollowing}
      onTouchMove={pauseFollowing}
      onPointerDown={pauseFollowing}
      onKeyDown={pauseFollowing}
    >
      {segments.map((segment, index) => (
        <TranscriptLine
          key={index}
          segment={segment}
          index={index}
          activeLine={activeLine}
          onSeek={seek}
        />
      ))}
    </ol>
  );
});

/** The transcript part of the recording panel: its state for the file's status, or the lines. */
export function TranscriptSection({
  file,
  transcript: { state, reload },
  activeLine,
  onSeek,
}: {
  file: MeetingFile;
  transcript: ReturnType<typeof useTranscript>;
  activeLine: ActiveLineStore;
  onSeek: (ms: number) => void;
}) {
  const headingId = useId();
  const segments = state.type === 'loaded' ? state.segments : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-muted text-xs font-medium tracking-wide uppercase">
          Transcript
        </h3>
        {segments !== null && segments.length > 0 && (
          <p className="text-muted text-xs">Select a line to play from there.</p>
        )}
      </div>
      {file.status === 'PROCESSING' && (
        <p className="text-muted text-sm">The transcript appears once processing has finished.</p>
      )}
      {file.status === 'FAILED' && (
        <p className="text-muted text-sm">
          There is no transcript: processing of this recording failed.
        </p>
      )}
      {file.status === 'READY' && state.type === 'loading' && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the transcript">
          <Skeleton className="h-5 w-11/12 rounded-lg" />
          <Skeleton className="h-5 w-4/5 rounded-lg" />
          <Skeleton className="h-5 w-2/3 rounded-lg" />
        </div>
      )}
      {file.status === 'READY' && state.type === 'error' && (
        <PanelError message={state.message} onRetry={reload} />
      )}
      {file.status === 'READY' &&
        state.type === 'loaded' &&
        (segments === null || segments.length === 0) && (
          <p className="text-muted text-sm">There is no transcript for this recording.</p>
        )}
      {file.status === 'READY' && segments !== null && segments.length > 0 && (
        <TranscriptList segments={segments} activeLine={activeLine} onSeek={onSeek} />
      )}
    </section>
  );
}

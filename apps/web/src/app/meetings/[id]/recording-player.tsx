'use client';

import { Skeleton } from '@heroui/react';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatDuration, type MeetingFile, type TranscriptSegment } from '../../meetings';
import {
  FILE_GONE_MESSAGE,
  PLAYER_DECODE_MESSAGE,
  PLAYER_FAILED_MESSAGE,
  PLAYER_REFRESH_RESET_SECONDS,
  PLAYER_UNSUPPORTED_MESSAGE,
  TRANSCRIPT_FAILED_MESSAGE,
  TRANSCRIPT_FOLLOW_PAUSE_MS,
} from './constants';
import { type FileLinkState, PanelError } from './file-preview';
import { type FileLink, fetchTranscript, inlineUrl, probeFileLink } from './files-api';

type TranscriptState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  /** `null`: the recording has no transcript (processed before recordings were transcribed). */
  | { type: 'loaded'; segments: TranscriptSegment[] | null };

/** Loads the transcript once the recording is `READY` (again after `reload`). */
function useTranscript(file: MeetingFile) {
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
type ActiveLineStore = {
  get: () => number;
  set: (index: number) => void;
  subscribe: (listener: () => void) => () => void;
};

function createActiveLineStore(): ActiveLineStore {
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
function findSegmentIndex(segments: TranscriptSegment[], ms: number): number {
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

/** A WebVTT timestamp, `hh:mm:ss.mmm`. */
function vttTime(ms: number): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms % 1000, 3)}`;
}

/**
 * Cue text as WebVTT reads it: a cue ends at a blank line, and `<` / `&` start tags and character
 * references, so they are escaped (with `>`, which also covers `-->`).
 */
function vttText(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * The transcript as a WebVTT `data:` URL for the video's captions track. A `data:` URL needs no
 * revoking, unlike a blob URL, and is same-origin for the track whatever serves the video.
 */
function toCaptionsUrl(segments: TranscriptSegment[]): string {
  const cues = segments.map(
    (segment) =>
      `${vttTime(segment.startMs)} --> ${vttTime(segment.endMs)}\n${vttText(segment.text)}`,
  );
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${cues.join('\n\n')}\n`)}`;
}

/** Why the media failed for good, by its error code (asking the API when it cannot tell). */
async function playerFailureMessage(code: number | undefined, link: FileLink): Promise<string> {
  if (code === MediaError.MEDIA_ERR_DECODE) return PLAYER_DECODE_MESSAGE;
  if (code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return PLAYER_FAILED_MESSAGE;
  // Browsers report a failed request (403, 404, 5xx) with the same code as an unknown format.
  const served = await probeFileLink(link);
  if (served === 'ok') return PLAYER_UNSUPPORTED_MESSAGE;
  return served === 'gone' ? FILE_GONE_MESSAGE : PLAYER_FAILED_MESSAGE;
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

/**
 * The player of an audio or video file with its transcript, below the file's row. The media
 * streams from the short-lived signed link (served inline with byte ranges). When loading fails
 * (the link expired during a long session), one fresh link is requested and playback continues
 * from the same position; another failure before playback has moved on, or an error a new link
 * cannot fix (decoding), is shown with Try again.
 */
export function RecordingPanel({
  id,
  file,
  link: fileLink,
  playOnOpen,
}: {
  id: string;
  file: MeetingFile;
  link: FileLinkState;
  /** Start playing once the media can play (the panel was opened with Play). */
  playOnOpen: boolean;
}) {
  const { link, error, load } = fileLink;
  const transcript = useTranscript(file);
  const segments = transcript.state.type === 'loaded' ? transcript.state.segments : null;
  const isVideo = file.kind === 'VIDEO';
  const headingId = useId();
  const [activeLine] = useState(createActiveLineStore);

  const media = useRef<HTMLMediaElement | null>(null);
  /** Position to restore (and whether to play) once the next source has loaded its metadata. */
  const resume = useRef<{ seconds: number; play: boolean } | null>(
    playOnOpen ? { seconds: 0, play: true } : null,
  );
  const position = useRef(0);
  const isPlaying = useRef(false);
  /** Where the broken link was replaced; `null` once playback has moved on from there. */
  const refreshedAt = useRef<number | null>(null);
  const [failure, setFailure] = useState<{ link: FileLink; message: string } | null>(null);
  const shownError = error ?? (failure !== null && failure.link === link ? failure.message : null);

  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
    // Highlight the current line as soon as the transcript is there, even while paused.
    if (segments) activeLine.set(findSegmentIndex(segments, position.current * 1000));
  }, [segments, activeLine]);

  const captionsUrl = useMemo(
    () => (isVideo && segments && segments.length > 0 ? toCaptionsUrl(segments) : null),
    [isVideo, segments],
  );

  const setMedia = useCallback((element: HTMLMediaElement | null) => {
    media.current = element;
  }, []);

  function updatePosition() {
    const element = media.current;
    // A source being (re)loaded reports position 0: keep the position to resume from.
    if (!element || element.readyState < HTMLMediaElement.HAVE_METADATA) return;
    position.current = element.currentTime;
    const from = refreshedAt.current;
    if (from !== null && Math.abs(element.currentTime - from) >= PLAYER_REFRESH_RESET_SECONDS) {
      refreshedAt.current = null;
    }
    const current = segmentsRef.current;
    if (current) activeLine.set(findSegmentIndex(current, element.currentTime * 1000));
  }

  function handleLoadedMetadata() {
    const element = media.current;
    const target = resume.current;
    if (!element || !target) return;
    resume.current = null;
    if (target.seconds > 0) element.currentTime = target.seconds;
    // Refused without a recent user gesture: the user starts it from the controls then.
    if (target.play) element.play().catch(() => {});
  }

  async function handleError() {
    const element = media.current;
    if (!element || !link) return;
    const code = element.error?.code;
    // Only a failed load can be an expired link; a decode error stays with any link.
    const mayBeLink =
      code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
    if (mayBeLink && refreshedAt.current === null) {
      refreshedAt.current = position.current;
      resume.current = { seconds: position.current, play: isPlaying.current };
      void load(true);
      return;
    }
    const message = await playerFailureMessage(code, link);
    setFailure({ link, message });
  }

  function tryAgain() {
    setFailure(null);
    // An automatic refresh that failed keeps its position and whether it was playing.
    resume.current ??= { seconds: position.current, play: false };
    void load(true);
  }

  const seek = useCallback(
    (ms: number) => {
      const element = media.current;
      const current = segmentsRef.current;
      if (current) activeLine.set(findSegmentIndex(current, ms));
      position.current = ms / 1000;
      if (!element || element.readyState < HTMLMediaElement.HAVE_METADATA) {
        resume.current = { seconds: ms / 1000, play: true };
        return;
      }
      element.currentTime = ms / 1000;
      element.play().catch(() => {});
    },
    [activeLine],
  );

  const mediaProps = {
    ref: setMedia,
    src: link ? inlineUrl(link) : undefined,
    controls: true,
    preload: 'metadata',
    'aria-label': `${isVideo ? 'Video' : 'Audio'} player of ${file.originalName}`,
    onLoadedMetadata: handleLoadedMetadata,
    onPlay: () => {
      isPlaying.current = true;
    },
    onPause: () => {
      isPlaying.current = false;
    },
    onTimeUpdate: updatePosition,
    onSeeked: updatePosition,
    onError: () => void handleError(),
  } as const;

  return (
    // No frame on phones: the native controls need the width for their timeline.
    <div id={id} className="sm:border-default flex flex-col gap-4 sm:rounded-xl sm:border sm:p-3">
      {shownError !== null && <PanelError message={shownError} onRetry={tryAgain} />}
      {shownError === null && link === null && (
        <Skeleton
          className={`rounded-lg ${isVideo ? 'aspect-video w-full' : 'h-14'}`}
          aria-busy="true"
          aria-label={`Loading the player of ${file.originalName}`}
        />
      )}
      {shownError === null &&
        link !== null &&
        (isVideo ? (
          <video {...mediaProps} playsInline className="max-h-[60vh] w-full rounded-lg bg-black">
            {captionsUrl !== null && (
              <track kind="captions" srcLang="en" label="English" src={captionsUrl} />
            )}
          </video>
        ) : (
          <audio {...mediaProps} className="recording-audio w-full" />
        ))}

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
        {file.status === 'READY' && transcript.state.type === 'loading' && (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the transcript">
            <Skeleton className="h-5 w-11/12 rounded-lg" />
            <Skeleton className="h-5 w-4/5 rounded-lg" />
            <Skeleton className="h-5 w-2/3 rounded-lg" />
          </div>
        )}
        {file.status === 'READY' && transcript.state.type === 'error' && (
          <PanelError message={transcript.state.message} onRetry={transcript.reload} />
        )}
        {file.status === 'READY' &&
          transcript.state.type === 'loaded' &&
          (segments === null || segments.length === 0) && (
            <p className="text-muted text-sm">There is no transcript for this recording.</p>
          )}
        {file.status === 'READY' && segments !== null && segments.length > 0 && (
          <TranscriptList segments={segments} activeLine={activeLine} onSeek={seek} />
        )}
      </section>
    </div>
  );
}

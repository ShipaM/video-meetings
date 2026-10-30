'use client';

import { Skeleton } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeetingFile } from '../../meetings';
import { toCaptionsUrl } from './captions';
import {
  FILE_GONE_MESSAGE,
  PLAYER_DECODE_MESSAGE,
  PLAYER_FAILED_MESSAGE,
  PLAYER_REFRESH_RESET_SECONDS,
  PLAYER_UNSUPPORTED_MESSAGE,
} from './constants';
import { type FileLinkState, PanelError } from './file-preview';
import { type FileLink, inlineUrl, probeFileLink } from './files-api';
import {
  TranscriptSection,
  createActiveLineStore,
  findSegmentIndex,
  useTranscript,
} from './transcript';

/** Why the media failed for good, by its error code (asking the API when it cannot tell). */
async function playerFailureMessage(code: number | undefined, link: FileLink): Promise<string> {
  if (code === MediaError.MEDIA_ERR_DECODE) return PLAYER_DECODE_MESSAGE;
  if (code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return PLAYER_FAILED_MESSAGE;
  // Browsers report a failed request (403, 404, 5xx) with the same code as an unknown format.
  const served = await probeFileLink(link);
  if (served === 'ok') return PLAYER_UNSUPPORTED_MESSAGE;
  return served === 'gone' ? FILE_GONE_MESSAGE : PLAYER_FAILED_MESSAGE;
}

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

      <TranscriptSection
        file={file}
        transcript={transcript}
        activeLine={activeLine}
        onSeek={seek}
      />
    </div>
  );
}

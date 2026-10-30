import type { TranscriptSegment } from '../../meetings';

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
export function toCaptionsUrl(segments: TranscriptSegment[]): string {
  const cues = segments.map(
    (segment) =>
      `${vttTime(segment.startMs)} --> ${vttTime(segment.endMs)}\n${vttText(segment.text)}`,
  );
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${cues.join('\n\n')}\n`)}`;
}

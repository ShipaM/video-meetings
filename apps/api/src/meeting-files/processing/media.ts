import { stat } from 'node:fs/promises';
import { FAILURE_REASONS, ffmpegPath, ffprobePath } from './processing.config.js';
import { ProcessError, runProcess } from './run-process.js';

/** Why a recording cannot be transcribed; `reason` is shown to the user as the failure reason. */
export class RecordingError extends Error {
  override readonly name = 'RecordingError';

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(reason, options);
  }
}

/** What ffprobe tells about a stored recording. */
export interface MediaInfo {
  /** `null` when the container does not state it (e.g. a WebM recorded in a browser). */
  durationMs: number | null;
  hasAudio: boolean;
}

interface ProbeOutput {
  format?: { duration?: string };
  streams?: { codec_type?: string }[];
}

/** A tool that rejected the file means the file is broken; anything else is a real error. */
const unreadable = (error: unknown): unknown =>
  error instanceof ProcessError
    ? new RecordingError(FAILURE_REASONS.unreadableRecording, { cause: error })
    : error;

/**
 * Reads the duration and the stream types of a recording with ffprobe (only the container
 * headers, so it is fast for any size). Rejects with `RecordingError` for a file ffprobe cannot
 * read.
 */
export async function probeMedia(filePath: string, signal: AbortSignal): Promise<MediaInfo> {
  let output: ProbeOutput;
  try {
    const json = await runProcess(
      ffprobePath(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type',
        '-of',
        'json',
        filePath,
      ],
      signal,
    );
    output = JSON.parse(json) as ProbeOutput;
  } catch (error) {
    throw error instanceof SyntaxError
      ? new RecordingError(FAILURE_REASONS.unreadableRecording, { cause: error })
      : unreadable(error);
  }
  const seconds = Number(output.format?.duration);
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    hasAudio: (output.streams ?? []).some((stream) => stream.codec_type === 'audio'),
  };
}

/** whisper.cpp reads 16 kHz mono 16-bit PCM WAV: 32 bytes per millisecond. */
const WAV_BYTES_PER_MS = 32;
/** A bit-exact WAV header written by ffmpeg (no metadata chunks). */
const WAV_HEADER_BYTES = 44;

/**
 * Writes the first audio track of `input` to `output` as 16 kHz mono WAV and resolves to its
 * duration in milliseconds. At most `maxMs` plus a second is written, so a recording whose
 * container hides its length still stops just over the limit instead of filling the disk.
 */
export async function extractAudio(
  input: string,
  output: string,
  maxMs: number,
  signal: AbortSignal,
): Promise<number> {
  const maxSeconds = String((maxMs + 1000) / 1000);
  try {
    await runProcess(
      ffmpegPath(),
      [
        ['-v', 'error', '-nostdin', '-y', '-i', input],
        ['-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'],
        ['-t', maxSeconds, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'],
        [output],
      ].flat(),
      signal,
      { stdout: false },
    );
  } catch (error) {
    throw unreadable(error);
  }
  const { size } = await stat(output);
  return Math.round(Math.max(0, size - WAV_HEADER_BYTES) / WAV_BYTES_PER_MS);
}

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { numberEnv } from '../../config/env.js';

/** Background processing settings, read from the environment (see `.env.example`). */

/**
 * `local`: transcripts by whisper.cpp and summaries by the local Ollama model; `fake`:
 * deterministic stand-ins (tests, dev).
 */
export type AiProvider = 'fake' | 'local';

export function aiProvider(): AiProvider {
  const value = process.env.AI_PROVIDER ?? 'fake';
  if (value !== 'fake' && value !== 'local') {
    throw new Error(`AI_PROVIDER must be "fake" or "local", got "${value}"`);
  }
  return value;
}

/**
 * Longest a document job may take, extraction and summary together; then it ends in `FAILED`.
 * CPU inference of a long summary can take minutes, hence the generous default.
 */
export function documentJobTimeoutMs(): number {
  return numberEnv('DOCUMENT_PROCESSING_TIMEOUT_SECONDS', 15 * 60) * 1000;
}

/**
 * The watchdog looks only at files `PROCESSING` without a change for this long; whether they are
 * stuck is decided by their job (see `FailStuckProcessingCommand`), not by the time.
 */
export const STUCK_PROCESSING_GRACE_MS = 15 * 60 * 1000;

export interface OllamaSettings {
  url: string;
  model: string;
  /** Context window in tokens; the Ollama default is small and silently cuts longer input. */
  numCtx: number;
}

export function ollamaSettings(): OllamaSettings {
  const model = process.env.OLLAMA_MODEL;
  if (!model) {
    throw new Error('OLLAMA_MODEL is not set (needed with AI_PROVIDER=local)');
  }
  return {
    url: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    model,
    numCtx: numberEnv('OLLAMA_NUM_CTX', 16384, 1),
  };
}

/** Recordings longer than this many minutes are not transcribed (`MAX_RECORDING_MINUTES`). */
export function maxRecordingMinutes(): number {
  return numberEnv('MAX_RECORDING_MINUTES', 180);
}

/** Probing a recording and extracting its audio, before the transcription starts. */
export const RECORDING_PREPARE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Longest the transcriber may take for a recording of `durationMs`: the duration times
 * `WHISPER_SPEED_FACTOR` (measured transcription time / audio time, with a safety margin) plus
 * `TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS` for loading the model.
 */
export function transcriptionTimeoutMs(durationMs: number): number {
  const factor = numberEnv('WHISPER_SPEED_FACTOR', 1.5);
  const margin = numberEnv('TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS', 300, 0) * 1000;
  return Math.ceil(durationMs * factor + margin);
}

/**
 * Longest the summary of a transcript of `durationMs` may take: the document budget
 * (`DOCUMENT_PROCESSING_TIMEOUT_SECONDS`) for every started hour, since a long transcript is
 * summarized in parts and then combined.
 */
export function transcriptSummaryTimeoutMs(durationMs: number): number {
  return documentJobTimeoutMs() * Math.max(1, Math.ceil(durationMs / (60 * 60 * 1000)));
}

/** pg-boss never lets a job run longer than this. */
const MAX_JOB_EXPIRATION_SECONDS = 24 * 60 * 60;

/**
 * pg-boss expiration of a recording job: every stage of the longest allowed recording (prepare,
 * transcription, summary) plus a minute. The stages' own timeouts fire first; this only frees a
 * job whose worker died. A limit whose stages cannot fit into pg-boss's 24 hours is refused (at
 * startup, where the queue is created), instead of jobs expiring in the middle of a transcription.
 */
export function recordingJobExpirationSeconds(): number {
  const longestRecordingMs = maxRecordingMinutes() * 60 * 1000;
  const longestMs =
    RECORDING_PREPARE_TIMEOUT_MS +
    transcriptionTimeoutMs(longestRecordingMs) +
    transcriptSummaryTimeoutMs(longestRecordingMs);
  const seconds = Math.ceil(longestMs / 1000) + 60;
  if (seconds > MAX_JOB_EXPIRATION_SECONDS) {
    const hours = (seconds / 3600).toFixed(1);
    throw new Error(
      `MAX_RECORDING_MINUTES=${maxRecordingMinutes()} needs recording jobs of up to ${hours} h ` +
        '(with WHISPER_SPEED_FACTOR and the timeouts), but pg-boss allows 24 h; lower the limit',
    );
  }
  return seconds;
}

const require = createRequire(import.meta.url);

/** The ffmpeg binary: `FFMPEG_PATH`, else the one `ffmpeg-static` installed, else `PATH`. */
export function ffmpegPath(): string {
  // `null` on a platform the package has no binary for.
  return process.env.FFMPEG_PATH || (require('ffmpeg-static') as string | null) || 'ffmpeg';
}

/** The ffprobe binary: `FFPROBE_PATH`, else the one `@ffprobe-installer` installed, else `PATH`. */
export function ffprobePath(): string {
  if (process.env.FFPROBE_PATH) {
    return process.env.FFPROBE_PATH;
  }
  try {
    // Loaded on demand: the package throws on a platform it has no binary for.
    return (require('@ffprobe-installer/ffprobe') as { path: string }).path;
  } catch {
    return 'ffprobe';
  }
}

export interface WhisperSettings {
  cliPath: string;
  modelPath: string;
  threads: number;
}

/** whisper.cpp settings for `AI_PROVIDER=local`; a missing model file fails at startup. */
export function whisperSettings(): WhisperSettings {
  const modelsDir = path.resolve(process.env.WHISPER_MODELS_DIR || './models');
  const modelPath = path.join(modelsDir, `ggml-${process.env.WHISPER_MODEL || 'small.en'}.bin`);
  if (!existsSync(modelPath)) {
    throw new Error(`Whisper model not found at ${modelPath} (needed with AI_PROVIDER=local)`);
  }
  return {
    cliPath: process.env.WHISPER_CLI_PATH || 'whisper-cli',
    modelPath,
    threads: numberEnv('WHISPER_THREADS', 4, 1),
  };
}

/** Extracted text beyond this many characters is cut (zip bombs, huge documents). */
export const MAX_EXTRACTED_CHARS = 2_000_000;

/** Failure reasons stored on a file (shown to users). */
export const FAILURE_REASONS = {
  summary: 'Summary could not be generated',
  timeout: 'Processing took too long',
  interrupted: 'Processing was interrupted',
  unexpected: 'Processing failed',
  unreadableRecording: 'The recording could not be read',
  noAudio: 'No audio found in the recording',
  noSpeech: 'No speech found in the recording',
  transcription: 'The recording could not be transcribed',
} as const;

/** Failure reason of a recording over `MAX_RECORDING_MINUTES`. */
export const tooLongReason = (minutes: number): string =>
  `Recording is longer than ${minutes} minute${minutes === 1 ? '' : 's'}`;

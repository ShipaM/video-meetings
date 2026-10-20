import { Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { WhisperSettings } from './processing.config.js';
import { runProcess } from './run-process.js';
import { type TranscriptPiece, Transcriber, TranscriptionError } from './transcriber.js';

/** The part of whisper.cpp's `-oj` output that is used. */
interface WhisperOutput {
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
}

/** Whisper's annotations for sounds that are not speech: `[BLANK_AUDIO]`, `(music)`, ... */
const NON_SPEECH = /^[[(][^\])]*[\])]$/;

/** The pieces of whisper.cpp JSON output, trimmed, without empty pieces and non-speech notes. */
export function parseWhisperOutput(json: string): TranscriptPiece[] {
  const output = JSON.parse(json) as WhisperOutput;
  if (!Array.isArray(output.transcription)) {
    throw new TranscriptionError('whisper.cpp output has no transcription');
  }
  return output.transcription.flatMap(({ offsets, text }) => {
    const trimmed = text?.trim() ?? '';
    const startMs = offsets?.from;
    const endMs = offsets?.to;
    if (!trimmed || NON_SPEECH.test(trimmed) || startMs === undefined || endMs === undefined) {
      return [];
    }
    return [{ startMs, endMs: Math.max(startMs, endMs), text: trimmed }];
  });
}

/**
 * Transcripts by whisper.cpp (`AI_PROVIDER=local`): `whisper-cli` runs as a child process, so a
 * crash or running out of memory ends only the job, and the job's signal kills it. English only
 * (`-l en`), JSON output with segment timestamps (`-oj`). No meeting content leaves the server.
 */
export class WhisperTranscriber extends Transcriber {
  private readonly logger = new Logger(WhisperTranscriber.name);

  constructor(private readonly settings: WhisperSettings) {
    super();
  }

  async transcribe(audioPath: string, signal: AbortSignal): Promise<TranscriptPiece[]> {
    // Written next to the audio, in the job's own directory.
    const outputBase = `${audioPath}.whisper`;
    try {
      await runProcess(
        this.settings.cliPath,
        [
          ['-m', this.settings.modelPath, '-f', audioPath, '-l', 'en'],
          ['-t', String(this.settings.threads), '-oj', '-of', outputBase, '-np'],
        ].flat(),
        signal,
        // The transcript is also printed; only the JSON file is read.
        { stdout: false },
      );
      return parseWhisperOutput(await readFile(`${outputBase}.json`, 'utf8'));
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const message = `whisper.cpp failed: ${String(error)}`;
      this.logger.warn(message);
      throw new TranscriptionError(message, { cause: error });
    }
  }
}

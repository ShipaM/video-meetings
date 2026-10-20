import { open } from 'node:fs/promises';
import { FakeControl } from './fake-control.js';
import { type TranscriptPiece, Transcriber, TranscriptionError } from './transcriber.js';

/** 16 kHz mono 16-bit PCM. */
const BYTES_PER_SECOND = 32_000;
/** A second whose loudest sample stays below this counts as silence. */
const SPEECH_LEVEL = 500;
/** A last window shorter than this joins the previous piece instead of becoming its own. */
const MIN_PIECE_MS = 500;

/** Offset of the samples: right after the `data` chunk header of the WAV. */
async function dataOffset(audioPath: string): Promise<number> {
  const handle = await open(audioPath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    const index = buffer.subarray(0, bytesRead).indexOf('data');
    return index < 0 ? 44 : index + 8;
  } finally {
    await handle.close();
  }
}

/**
 * Deterministic stand-in for whisper.cpp (`AI_PROVIDER=fake`): every second of the WAV that is
 * not silent becomes a piece "Fake speech <n>.", so a tone is "speech" and silence has none. Tests
 * steer it through `control` (fail, hang until aborted, hold calls until released).
 */
export class FakeTranscriber extends Transcriber {
  readonly control = new FakeControl();

  transcribe(audioPath: string, signal: AbortSignal): Promise<TranscriptPiece[]> {
    return this.control.run(
      signal,
      () => new TranscriptionError('Fake transcriber told to fail'),
      () => this.listen(audioPath),
    );
  }

  private async listen(audioPath: string): Promise<TranscriptPiece[]> {
    const offset = await dataOffset(audioPath);
    const handle = await open(audioPath, 'r');
    const pieces: TranscriptPiece[] = [];
    try {
      const window = Buffer.alloc(BYTES_PER_SECOND);
      for (let second = 0; ; second += 1) {
        const { bytesRead } = await handle.read(
          window,
          0,
          BYTES_PER_SECOND,
          offset + second * BYTES_PER_SECOND,
        );
        if (bytesRead < 2) {
          break;
        }
        const startMs = second * 1000;
        const endMs = startMs + Math.floor(bytesRead / (BYTES_PER_SECOND / 1000));
        let loudest = 0;
        for (let at = 0; at + 1 < bytesRead; at += 2) {
          loudest = Math.max(loudest, Math.abs(window.readInt16LE(at)));
        }
        const last = pieces.at(-1);
        if (loudest < SPEECH_LEVEL) {
          continue;
        }
        if (endMs - startMs < MIN_PIECE_MS && last?.endMs === startMs) {
          last.endMs = endMs;
        } else {
          pieces.push({ startMs, endMs, text: `Fake speech ${pieces.length + 1}.` });
        }
      }
    } finally {
      await handle.close();
    }
    return pieces;
  }
}

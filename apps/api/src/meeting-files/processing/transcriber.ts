/** A timed piece of a transcript. */
export interface TranscriptPiece {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Turns the speech in a recording's audio (16 kHz mono WAV) into English text with timestamps.
 * Bound to the local whisper.cpp or to a fake through `AI_PROVIDER`; the class is the injection
 * token.
 */
export abstract class Transcriber {
  /**
   * Resolves to the pieces in order (empty when there is no speech). Rejects with
   * `TranscriptionError` when the transcriber fails, and with the signal's reason once `signal` is
   * aborted (timeout or shutdown).
   */
  abstract transcribe(audioPath: string, signal: AbortSignal): Promise<TranscriptPiece[]>;
}

/** The transcriber could not transcribe the audio (a crash, a bad model, unreadable output). */
export class TranscriptionError extends Error {
  override readonly name = 'TranscriptionError';
}

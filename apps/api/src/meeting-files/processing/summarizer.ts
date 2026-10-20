/** What the text to summarize is: a meeting document or the transcript of a recording. */
export type SummarySource = 'document' | 'transcript';

/**
 * Turns the text of a meeting document or a recording's transcript into a short summary. Bound to
 * the local Ollama model or to a fake through `AI_PROVIDER`; the class is the injection token.
 */
export abstract class Summarizer {
  /**
   * Resolves to the summary. Rejects with `SummaryError` when no usable summary came back, and with
   * the signal's reason once `signal` is aborted (job timeout or shutdown).
   */
  abstract summarize(text: string, signal: AbortSignal, source?: SummarySource): Promise<string>;
}

/** The model could not produce a summary (unreachable, an error answer, an empty or invalid one). */
export class SummaryError extends Error {
  override readonly name = 'SummaryError';
}

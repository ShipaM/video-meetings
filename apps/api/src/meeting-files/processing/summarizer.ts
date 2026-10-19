/**
 * Turns the text of a meeting document (later: a transcript) into a short summary. Bound to the
 * local Ollama model or to a fake through `AI_PROVIDER`; the class is the injection token.
 */
export abstract class Summarizer {
  /**
   * Resolves to the summary. Rejects with `SummaryError` when no usable summary came back, and with
   * the signal's reason once `signal` is aborted (job timeout or shutdown).
   */
  abstract summarize(text: string, signal: AbortSignal): Promise<string>;
}

/** The model could not produce a summary (unreachable, an error answer, an empty or invalid one). */
export class SummaryError extends Error {
  override readonly name = 'SummaryError';
}

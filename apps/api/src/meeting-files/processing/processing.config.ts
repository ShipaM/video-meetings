import { numberEnv } from '../../config/env.js';

/** Background processing settings, read from the environment (see `.env.example`). */

/** `local`: summaries by the local Ollama model; `fake`: a deterministic stand-in (tests, dev). */
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

/** Extracted text beyond this many characters is cut (zip bombs, huge documents). */
export const MAX_EXTRACTED_CHARS = 2_000_000;

/** Failure reasons stored on a file (shown to users). */
export const FAILURE_REASONS = {
  summary: 'Summary could not be generated',
  timeout: 'Processing took too long',
  interrupted: 'Processing was interrupted',
  unexpected: 'Processing failed',
} as const;

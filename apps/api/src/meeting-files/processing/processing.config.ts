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

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

/**
 * Longest a document job may take, extraction and summary together; then it ends in `FAILED`.
 * CPU inference of a long summary can take minutes, hence the generous default.
 */
export function documentJobTimeoutMs(): number {
  return positiveNumber('DOCUMENT_PROCESSING_TIMEOUT_SECONDS', 15 * 60) * 1000;
}

/**
 * A file `PROCESSING` without any change for this long has lost its job: every attempt pg-boss
 * makes (the first and two retries) has timed out, with room for the retry delays.
 */
export function stuckProcessingMs(): number {
  return 3 * documentJobTimeoutMs() + 60 * 60 * 1000;
}

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
    numCtx: positiveNumber('OLLAMA_NUM_CTX', 16384),
  };
}

/** Extracted text beyond this many characters is cut (zip bombs, huge documents). */
export const MAX_EXTRACTED_CHARS = 2_000_000;

/** Failure reasons stored on a file (shown to users). */
export const FAILURE_REASONS = {
  summary: 'Summary could not be generated',
  timeout: 'Processing took too long',
  notStarted: 'Processing could not be started',
  interrupted: 'Processing was interrupted',
  unexpected: 'Processing failed',
} as const;

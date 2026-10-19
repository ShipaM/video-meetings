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

/** How often a worker looks for new jobs. */
export function jobsPollingIntervalSeconds(): number {
  return positiveNumber('JOBS_POLLING_INTERVAL_SECONDS', 2);
}

/** PostgreSQL schema of the pg-boss tables; Prisma only manages `public`. */
export function jobsSchema(): string {
  return process.env.PGBOSS_SCHEMA || 'pgboss';
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

/** Reason stored on a file whose processing failed for an unexpected reason. */
export const PROCESSING_FAILED_REASON = 'Processing failed';

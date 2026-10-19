import { stat } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { MAX_EXTRACTED_CHARS } from './processing.config.js';

/** Why a document has no usable text; `reason` is shown to the user as the failure reason. */
export class DocumentTextError extends Error {
  override readonly name = 'DocumentTextError';

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(reason, options);
  }
}

export const NO_TEXT_REASON = 'No text found in the document';
export const UNREADABLE_REASON = 'The document could not be read';

/**
 * PDF, DOCX and PPTX are parsed whole, so larger ones are not summarized; plain text is read only
 * up to the character cap and has no size limit.
 */
export const MAX_PARSED_DOCUMENT_BYTES = 100 * 1024 ** 2;
export const TOO_LARGE_REASON = 'The document is too large to summarize (over 100 MB)';

/** Heap of the extraction worker: a document that needs more fails instead of the API. */
const WORKER_HEAP_MB = 1024;

const WORKER_URL = new URL('./extract-text.worker.mjs', import.meta.url);

const EXTRACTABLE = new Set([
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** Runs the extraction worker; `signal` terminates it (no parse keeps running after a timeout). */
function runWorker(filePath: string, mimeType: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, {
      workerData: { filePath, mimeType, maxChars: MAX_EXTRACTED_CHARS },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    let settled = false;
    const settle = (finish: () => void) => {
      if (!settled) {
        settled = true;
        signal.removeEventListener('abort', onAbort);
        finish();
      }
    };
    const onAbort = () => {
      settle(() => reject(signal.reason as Error));
      void worker.terminate();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (text: string) => settle(() => resolve(text)));
    worker.once('error', (error) =>
      settle(() => reject(new DocumentTextError(UNREADABLE_REASON, { cause: error }))),
    );
    worker.once('exit', (code) =>
      settle(() => reject(new DocumentTextError(UNREADABLE_REASON, { cause: `exit ${code}` }))),
    );
  });
}

/**
 * The plain text of a stored document, trimmed and capped at `MAX_EXTRACTED_CHARS`, extracted in
 * a worker thread. Rejects with `DocumentTextError` for a file that cannot be read, is too large
 * or holds no text (a scanned PDF: no OCR), and with the signal's reason once `signal` is aborted.
 */
export async function extractDocumentText(
  filePath: string,
  mimeType: string,
  signal: AbortSignal,
): Promise<string> {
  if (!EXTRACTABLE.has(mimeType)) {
    throw new DocumentTextError(UNREADABLE_REASON);
  }
  let size: number;
  try {
    ({ size } = await stat(filePath));
  } catch (error) {
    throw new DocumentTextError(UNREADABLE_REASON, { cause: error });
  }
  if (mimeType !== 'text/plain' && size > MAX_PARSED_DOCUMENT_BYTES) {
    throw new DocumentTextError(TOO_LARGE_REASON);
  }

  const text = await runWorker(filePath, mimeType, signal);
  if (!text) {
    throw new DocumentTextError(NO_TEXT_REASON);
  }
  return text;
}
